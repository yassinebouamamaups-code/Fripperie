(function () {
    const productGrid = document.querySelector("[data-products-grid]");
    const selectionGrid = document.querySelector("[data-selection-grid]");
    const productDetail = document.querySelector("[data-product-detail]");
    const categorySizeFilter = document.querySelector("[data-catalog-size-filter]");
    const categorySortFilter = document.querySelector("[data-catalog-sort]");
    const hasProductUi = Boolean(productGrid || selectionGrid || productDetail);

    const CART_STORAGE_KEY = "laGoutteDeMerCart";
    const LAST_ORDER_STORAGE_KEY = "laGoutteDeMerLastOrder";
    const PAYPAL_PENDING_STORAGE_KEY = "laGoutteDeMerPendingPayPalOrder";
    const STRIPE_PENDING_STORAGE_KEY = "laGoutteDeMerPendingStripeSession";
    const CATALOG_CACHE_STORAGE_KEY = "laGoutteDeMerCatalogCache";
    const CATALOG_CACHE_DURATION_MS = 10 * 60 * 1000;
    const DEFAULT_IMAGE_FALLBACK = "";
    const status = document.querySelector("[data-products-status]");
    const sourceUrl = clean(window.RENDER_RUNTIME_CONFIG?.catalogSourceUrl)
        || clean(window.PRODUCTS_SOURCE_URL)
        || "https://docs.google.com/spreadsheets/d/1yZVWg-Ypzd2VtFE4tVf0XmVVvTqzgFu8TTq4KAyvsb0/export?format=csv&gid=1348794459";

    const shopConfig = resolveCheckoutConfig(window.SHOP_CHECKOUT_CONFIG || {});

    let currentOrder = null;
    let catalogProducts = [];
    let cartElements = null;
    let checkoutElements = null;
    let stripeClientConfig = null;
    let stripeSdkPromise = null;
    let stripeCheckoutState = null;
    let stripeMountingSignature = "";
    let stripeAutofillCheckTimer = 0;
    let checkoutShippingRequestId = 0;
    const preloadedPhotoUrls = new Set();
    let stripeCheckoutMode = "custom";
    let sendcloudServicePointSdkPromise = null;
    let checkoutShippingState = {
        options: [],
        selectedOptionId: "",
        servicePointPicker: {
            enabled: false,
            publicKey: ""
        },
        servicePointSelections: {},
        loading: false,
        error: ""
    };
    let checkoutShippingUpdateTimer = 0;
    let checkoutPromotionState = {
        code: "",
        promotion: null,
        loading: false,
        error: ""
    };

    function resolveCheckoutConfig(customConfig) {
        const seller = customConfig.seller || {};
        const backend = customConfig.backend || {};
        const paymentMethods = customConfig.paymentMethods || {};
        const documents = customConfig.documents || {};
        const emailDelivery = customConfig.emailDelivery || {};
        const sellerSupport = seller.support || {};

        return {
            backend: {
                baseUrl: clean(backend.baseUrl)
            },
            seller: {
                brandName: seller.brandName || "La Goutte de Mer Shop",
                email: seller.email || "lagouttedemer@gmail.com",
                phone: seller.phone || "+33 7 66 88 42 22",
                addressLine1: seller.addressLine1 || "Seysses",
                city: seller.city || "Seysses",
                postalCode: seller.postalCode || "",
                country: seller.country || "France",
                vatNumber: seller.vatNumber || "",
                siret: seller.siret || "",
                support: {
                    whatsappUrl: clean(sellerSupport.whatsappUrl) || "https://wa.me/33608917053",
                    sourcingInstagramUrl: clean(sellerSupport.sourcingInstagramUrl) || "",
                    sourcingInstagramLabel: clean(sellerSupport.sourcingInstagramLabel) || "@lagouttedemershop",
                    affordableInstagramUrl: clean(sellerSupport.affordableInstagramUrl) || "",
                    affordableInstagramLabel: clean(sellerSupport.affordableInstagramLabel) || "@maisongouttedemer"
                }
            },
            documents: {
                invoicePrefix: documents.invoicePrefix || "FAC"
            },
            paymentMethods: {
                stripe: {
                    id: "stripe",
                    enabled: paymentMethods.stripe?.enabled !== false,
                    label: paymentMethods.stripe?.label || "Stripe",
                    description: paymentMethods.stripe?.description || "",
                    checkoutUrl: clean(paymentMethods.stripe?.checkoutUrl),
                    logo: "assets/images/stripe-badge.svg",
                    secureLabel: paymentMethods.stripe?.secureLabel || "Paiement sécurisé via Stripe",
                    supportedMethods: normalizePaymentBadges(paymentMethods.stripe?.supportedMethods, ["CB", "Visa", "Mastercard", "Klarna"])
                },
                paypal: {
                    id: "paypal",
                    enabled: paymentMethods.paypal?.enabled !== false,
                    label: paymentMethods.paypal?.label || "PayPal",
                    description: paymentMethods.paypal?.description || "",
                    checkoutUrl: clean(paymentMethods.paypal?.checkoutUrl),
                    logo: "assets/images/paypal-badge.svg",
                    secureLabel: paymentMethods.paypal?.secureLabel || "Paiement sécurisé via PayPal",
                    supportedMethods: normalizePaymentBadges(paymentMethods.paypal?.supportedMethods, [])
                }
            },
            emailDelivery: {
                provider: clean(emailDelivery.provider || "emailjs").toLowerCase(),
                publicKey: clean(emailDelivery.publicKey),
                serviceId: clean(emailDelivery.serviceId),
                templates: {
                    clientSummary: clean(emailDelivery.templates?.clientSummary),
                    clientInvoice: clean(emailDelivery.templates?.clientInvoice),
                    sellerInvoice: clean(emailDelivery.templates?.sellerInvoice)
                }
            }
        };
    }

    function clean(value) {
        return String(value || "").trim();
    }

    function normalizePaymentBadges(value, fallback = []) {
        const entries = Array.isArray(value) ? value : fallback;
        return entries
            .map((entry) => clean(entry))
            .filter(Boolean);
    }

    function normalizeCategory(value) {
        const normalized = clean(value)
            .toLowerCase()
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .replace(/[^a-z]/g, "");

        if (normalized.startsWith("homme")) return "hommes";
        if (normalized.startsWith("femme")) return "femmes";
        if (normalized.startsWith("accessoire")) return "accessoires";
        return clean(value).toLowerCase();
    }

    function categoryPage(product) {
        const category = normalizeCategory(product.categorie);
        return ["hommes", "femmes", "accessoires"].includes(category) ? `${category}.html` : "index.html";
    }

    function productPage(product) {
        return `article.html?id=${encodeURIComponent(clean(product.id))}`;
    }

    function normalizeStatus(value) {
        return clean(value)
            .toLowerCase()
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "");
    }

    function isUnavailable(product) {
        return normalizeStatus(product.statut) === "indisponible";
    }

    async function fetchAvailabilityOverrides() {
        if (!shopConfig.backend.baseUrl) {
            return [];
        }

        try {
            const response = await fetch(`${shopConfig.backend.baseUrl}/api/catalog/availability`);
            if (!response.ok) return [];
            const payload = await response.json().catch(() => ({}));
            return Array.isArray(payload.unavailableIds) ? payload.unavailableIds.map((id) => clean(id)) : [];
        } catch (error) {
            return [];
        }
    }

    function applyAvailabilityOverrides(products, unavailableIds) {
        if (!Array.isArray(unavailableIds) || !unavailableIds.length) {
            return products;
        }

        const soldIds = new Set(unavailableIds.map((id) => clean(id)).filter(Boolean));
        return products.map((product) => soldIds.has(clean(product.id))
            ? { ...product, statut: "indisponible" }
            : product
        );
    }

    function escapeHtml(value) {
        const div = document.createElement("div");
        div.textContent = clean(value);
        return div.innerHTML;
    }

    function escapeAttribute(value) {
        return escapeHtml(value).replace(/"/g, "&quot;");
    }

    function parseCsv(text) {
        const rows = [];
        let row = [];
        let cell = "";
        let quoted = false;

        for (let i = 0; i < text.length; i += 1) {
            const char = text[i];
            const next = text[i + 1];

            if (char === '"' && quoted && next === '"') {
                cell += '"';
                i += 1;
            } else if (char === '"') {
                quoted = !quoted;
            } else if (char === "," && !quoted) {
                row.push(cell);
                cell = "";
            } else if ((char === "\n" || char === "\r") && !quoted) {
                if (char === "\r" && next === "\n") i += 1;
                row.push(cell);
                if (row.some(Boolean)) rows.push(row);
                row = [];
                cell = "";
            } else {
                cell += char;
            }
        }

        row.push(cell);
        if (row.some(Boolean)) rows.push(row);

        const headers = rows.shift().map((header) => header.trim());
        if (!headers.includes("id") || !headers.includes("categorie") || !headers.includes("nom")) {
            throw new Error("Format CSV invalide");
        }

        return rows
            .map((cells) => {
                const item = {};
                headers.forEach((header, index) => {
                    item[header] = (cells[index] || "").trim();
                });
                return item;
            })
            .filter((item) => item.id || item.categorie || item.nom || item.prix || item.promo || item.description || item.photos || item.statut);
    }

    function isSelected(value) {
        return ["oui", "yes", "true", "1", "x", "selection", "sélection"].includes(clean(value).toLowerCase());
    }

    function parsePrice(value) {
        const normalized = clean(value)
            .replace(/\s/g, "")
            .replace("EUR", "")
            .replace(/\u20ac/g, "")
            .replace(/\u00e2\u201a\u00ac/g, "")
            .replace(",", ".");
        const number = Number.parseFloat(normalized);
        return Number.isFinite(number) ? number : 0;
    }

    function formatPrice(value) {
        return value.toLocaleString("fr-FR", {
            style: "currency",
            currency: "EUR"
        });
    }

    function loadCachedCatalogText() {
        try {
            const raw = localStorage.getItem(CATALOG_CACHE_STORAGE_KEY);
            if (!raw) return "";
            const payload = JSON.parse(raw);
            if (!payload || payload.sourceUrl !== sourceUrl || !payload.text || !payload.savedAt) {
                return "";
            }
            if ((Date.now() - Number(payload.savedAt)) > CATALOG_CACHE_DURATION_MS) {
                return "";
            }
            return String(payload.text);
        } catch (error) {
            return "";
        }
    }

    function saveCachedCatalogText(text) {
        try {
            localStorage.setItem(CATALOG_CACHE_STORAGE_KEY, JSON.stringify({
                sourceUrl,
                text,
                savedAt: Date.now()
            }));
        } catch (error) {
            // Ignore cache write failures and continue with network-only behavior.
        }
    }

    async function fetchCatalogText() {
        const cachedText = loadCachedCatalogText();
        if (cachedText) {
            return cachedText;
        }

        const response = await fetch(sourceUrl, { cache: "force-cache" });
        if (!response.ok) {
            throw new Error("Source produits indisponible");
        }

        const text = await response.text();
        saveCachedCatalogText(text);
        return text;
    }

    function displayPrice(value) {
        const parsed = parsePrice(value);
        return parsed > 0 ? formatPrice(parsed) : clean(value);
    }

    function driveImageUrl(fileId, width = 1600) {
        return `https://drive.google.com/thumbnail?id=${fileId}&sz=w${width}`;
    }

    function extractDriveId(url) {
        const value = clean(url);
        if (!value) return "";

        const byQuery = value.match(/[?&]id=([a-zA-Z0-9_-]+)/);
        if (byQuery) return byQuery[1];

        const byPath = value.match(/\/d\/([a-zA-Z0-9_-]+)/);
        if (byPath) return byPath[1];

        return "";
    }

    function normalizePhotoUrl(photo) {
        const value = clean(photo);
        if (!value) return "";

        if (value.includes("drive.google.com") || value.includes("googleusercontent.com")) {
            const fileId = extractDriveId(value);
            return fileId ? driveImageUrl(fileId) : value;
        }

        return value;
    }

    function photoUrlForWidth(photo, width) {
        const normalized = normalizePhotoUrl(photo);
        if (!normalized) return "";

        const fileId = extractDriveId(normalized);
        return fileId ? driveImageUrl(fileId, width) : normalized;
    }

    function photoVariant(photo, variant = "detail") {
        const widths = {
            thumb: 240,
            cart: 280,
            mini: 720,
            card: 900,
            detail: 1600
        };

        return photoUrlForWidth(photo, widths[variant] || widths.detail);
    }

    function preloadImageUrl(url) {
        const imageUrl = clean(url);
        if (!imageUrl || preloadedPhotoUrls.has(imageUrl)) {
            return;
        }

        preloadedPhotoUrls.add(imageUrl);
        const image = new Image();
        image.decoding = "async";
        image.src = imageUrl;
    }

    function preloadProductDetailGallery(root) {
        if (!root) return;
        root.querySelectorAll(".product-detail__thumb[data-photo]").forEach((thumb) => {
            preloadImageUrl(thumb.dataset.photo);
        });
    }

    function photosOf(product) {
        const remotePhotos = (product.photos || "")
            .split(/[|;]/)
            .map((photo) => normalizePhotoUrl(photo))
            .filter(Boolean);

        return remotePhotos.filter((photo, index, list) => list.indexOf(photo) === index);
    }

    function productPrice(product) {
        return product.promo || product.prix || "";
    }

    function normalizePromoCode(value) {
        return clean(value).replace(/\s+/g, "").toUpperCase();
    }

    function closestFromEventTarget(target, selector) {
        return target instanceof Element ? target.closest(selector) : null;
    }

    function loadCart() {
        try {
            const saved = localStorage.getItem(CART_STORAGE_KEY);
            return saved ? JSON.parse(saved) : [];
        } catch (error) {
            return [];
        }
    }

    function saveCart(items) {
        localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(items));
        invalidatePendingCheckoutState();
    }

    function saveLastOrder(order) {
        localStorage.setItem(LAST_ORDER_STORAGE_KEY, JSON.stringify(order));
    }

    function invalidatePendingCheckoutState() {
        currentOrder = null;
        clearPendingPayPalOrder();
        clearPendingStripeSession();
        resetStripeCheckoutState();
        resetCheckoutPromotionState();

        if (!checkoutElements) {
            return;
        }

        checkoutElements.feedback.textContent = "";
        checkoutElements.success.hidden = true;
        checkoutElements.form.hidden = false;
        checkoutElements.payNow.href = "#";
        checkoutElements.payNow.setAttribute("aria-disabled", "true");

        if (!document.body.classList.contains("checkout-is-open")) {
            return;
        }

        const items = loadCart();
        if (!items.length) {
            closeCheckout();
            closeCart();
            return;
        }

        renderCheckoutSummary(items);
        updateCheckoutShippingOptions();
        syncCheckoutPaymentUi();
    }

    function priceMarkup(product, className) {
        const price = product.prix || "";
        const promo = product.promo || "";

        if (promo) {
            return `
                <p class="${className} price price--promo">
                    <span class="price__old">${price}</span>
                    <span class="price__new">${promo}</span>
                </p>
            `;
        }

        return `<p class="${className} price"><span>${price}</span></p>`;
    }

    function sizeMarkup(product, className) {
        const size = clean(product.taille);
        if (!size) return "";
        return `<p class="${className}">Taille : <span>${escapeHtml(size)}</span></p>`;
    }

    function cartButtonMarkup(product, className) {
        const unavailable = isUnavailable(product);
        const label = unavailable ? "Article indisponible" : "Ajouter au panier";
        const photos = photosOf(product);
        const mainPhoto = photoVariant(photos[0], "cart") || DEFAULT_IMAGE_FALLBACK;

        return `
            <button
                class="button button--small ${className}"
                type="button"
                data-add-to-cart
                data-id="${escapeAttribute(product.id)}"
                data-name="${escapeAttribute(product.nom)}"
                data-price="${escapeAttribute(productPrice(product))}"
                data-category="${escapeAttribute(product.categorie)}"
                data-image="${escapeAttribute(mainPhoto)}"
                data-size="${escapeAttribute(product.taille)}"
                data-unavailable="${unavailable ? "true" : "false"}"
                ${unavailable ? "disabled aria-disabled=\"true\"" : ""}
            >${label}</button>
        `;
    }

    function catalogCard(product) {
        const photos = photosOf(product);
        const mainPhoto = photoVariant(photos[0], "card") || DEFAULT_IMAGE_FALLBACK;
        const fallbackPhoto = photoVariant(photos[1], "card") || DEFAULT_IMAGE_FALLBACK;
        const thumbnails = photos.map((photo, index) => `
            <button class="catalog-card__thumb${index === 0 ? " is-active" : ""}" type="button" data-photo="${photoVariant(photo, "card")}" aria-label="Voir la photo ${index + 1}">
                <img src="${photoVariant(photo, "thumb")}" alt="" loading="lazy" decoding="async" data-fallback-photo="${escapeAttribute(index === 0 ? fallbackPhoto : DEFAULT_IMAGE_FALLBACK)}">
            </button>
        `).join("");

        return `
            <article class="catalog-card">
                <div class="catalog-card__media">
                    <a href="${productPage(product)}" class="catalog-card__link" aria-label="Voir ${escapeAttribute(product.nom)}">
                        <img class="catalog-card__image" src="${mainPhoto}" alt="" loading="lazy" decoding="async" data-fallback-photo="${escapeAttribute(fallbackPhoto)}">
                    </a>
                </div>
                ${photos.length > 1 ? `<div class="catalog-card__thumbs">${thumbnails}</div>` : ""}
                <div class="catalog-card__content">
                    <p class="catalog-card__status">${product.statut || "disponible"}</p>
                    <h2><a href="${productPage(product)}" class="catalog-card__title-link">${product.nom}</a></h2>
                    ${sizeMarkup(product, "catalog-card__size")}
                    <p>${product.description}</p>
                    ${priceMarkup(product, "catalog-card__price")}
                    <div class="catalog-card__actions">
                        <a href="${productPage(product)}" class="button button--small">Voir l'article</a>
                        ${cartButtonMarkup(product, "catalog-card__cart")}
                    </div>
                </div>
            </article>
        `;
    }

    function miniCard(product) {
        const photos = photosOf(product);
        const mainPhoto = photoVariant(photos[0], "mini") || DEFAULT_IMAGE_FALLBACK;
        const fallbackPhoto = photoVariant(photos[1], "mini") || DEFAULT_IMAGE_FALLBACK;

        return `
            <article class="mini-product">
                <a href="${productPage(product)}" aria-label="Voir l'article">
                    <img src="${mainPhoto}" alt="" loading="lazy" decoding="async" data-fallback-photo="${escapeAttribute(fallbackPhoto)}">
                    <h3>${product.nom}</h3>
                    ${sizeMarkup(product, "mini-product__size")}
                    ${priceMarkup(product, "mini-product__price")}
                </a>
                ${cartButtonMarkup(product, "mini-product__cart")}
            </article>
        `;
    }

    function detailView(product) {
        const photos = photosOf(product);
        const mainPhoto = photoVariant(photos[0], "detail") || DEFAULT_IMAGE_FALLBACK;
        const fallbackPhoto = photoVariant(photos[1], "detail") || DEFAULT_IMAGE_FALLBACK;
        const thumbnails = photos.map((photo, index) => `
            <button class="product-detail__thumb${index === 0 ? " is-active" : ""}" type="button" data-photo="${photoVariant(photo, "detail")}" aria-label="Voir la photo ${index + 1}">
                <img src="${photoVariant(photo, "thumb")}" alt="" loading="lazy" decoding="async" data-fallback-photo="${escapeAttribute(index === 0 ? fallbackPhoto : DEFAULT_IMAGE_FALLBACK)}">
            </button>
        `).join("");

        return `
            <article class="product-detail-card">
                <div class="product-detail__media">
                    <img class="product-detail__image" src="${mainPhoto}" alt="" decoding="async" fetchpriority="high" data-fallback-photo="${escapeAttribute(fallbackPhoto)}">
                    ${photos.length > 1 ? `<div class="product-detail__thumbs">${thumbnails}</div>` : ""}
                </div>
                <div class="product-detail__content">
                    <p class="catalog-card__status">${product.statut || "disponible"}</p>
                    <h1>${product.nom}</h1>
                    ${sizeMarkup(product, "product-detail__size")}
                    <p class="product-detail__description">${product.description || ""}</p>
                    ${priceMarkup(product, "product-detail__price")}
                    <div class="product-detail__actions">
                        ${cartButtonMarkup(product, "product-detail__cart")}
                        <a href="${categoryPage(product)}" class="button button--small">Retour categorie</a>
                    </div>
                    ${productSupportMarkup()}
                </div>
            </article>
        `;
    }

    function productSupportMarkup() {
        const support = shopConfig.seller.support || {};
        const whatsappUrl = clean(support.whatsappUrl);
        const sourcingInstagramUrl = clean(support.sourcingInstagramUrl);
        const sourcingInstagramLabel = clean(support.sourcingInstagramLabel) || "@lagouttedemershop";
        const affordableInstagramUrl = clean(support.affordableInstagramUrl);
        const affordableInstagramLabel = clean(support.affordableInstagramLabel) || "@maisongouttedemer";

        const actions = [
            whatsappUrl
                ? `<a href="${escapeAttribute(whatsappUrl)}" class="button button--small" target="_blank" rel="noopener">Contacter sur WhatsApp</a>`
                : "",
            sourcingInstagramUrl
                ? `<a href="${escapeAttribute(sourcingInstagramUrl)}" class="button button--small product-detail__support-button" target="_blank" rel="noopener">Voir la page Instagram ${escapeHtml(sourcingInstagramLabel)}</a>`
                : ""
        ].filter(Boolean).join("");

        if (!actions) {
            return "";
        }

        const affordableSupport = affordableInstagramUrl
            ? `
                <p class="product-detail__support-note">
                    Tu ne trouves pas chaussure &agrave; ton pied ?
                    <a href="${escapeAttribute(affordableInstagramUrl)}" target="_blank" rel="noopener">Ecris moi sur instagram ${escapeHtml(affordableInstagramLabel)}</a>
                    pour un service plus personnalis&eacute;.
                </p>
            `
            : "";

        return `
            <aside class="product-detail__support" aria-label="Aide au choix">
                <p class="product-detail__support-eyebrow">Besoin d'aide pour choisir ?</p>
                <p class="product-detail__support-text">Une question sur les mesures, la coupe ou l'etat d'un article ? Ecris-moi sur WhatsApp, retrouve-moi directement sur Instagram.</p>
                ${affordableSupport}
                <div class="product-detail__support-actions">
                    ${actions}
                </div>
            </aside>
        `;
    }

    function renderCatalog(products) {
        if (!productGrid) return;

        const category = normalizeCategory(productGrid.dataset.category);
        const categoryProducts = products.filter((product) => normalizeCategory(product.categorie) === category);
        initializeCatalogControls(categoryProducts);

        const selectedSize = clean(categorySizeFilter?.value);
        const selectedSort = clean(categorySortFilter?.value);

        let filtered = categoryProducts.filter((product) => {
            if (!selectedSize) return true;
            return clean(product.taille) === selectedSize;
        });

        if (selectedSort === "price-asc") {
            filtered = [...filtered].sort((left, right) => parsePrice(productPrice(left)) - parsePrice(productPrice(right)));
        } else if (selectedSort === "price-desc") {
            filtered = [...filtered].sort((left, right) => parsePrice(productPrice(right)) - parsePrice(productPrice(left)));
        }

        if (!filtered.length) {
            productGrid.innerHTML = `<p class="catalog-empty">Aucun article disponible pour le moment.</p>`;
            if (status) status.textContent = "0 article";
            return;
        }

        productGrid.innerHTML = filtered.map(catalogCard).join("");
        if (status) status.textContent = `${filtered.length} article${filtered.length > 1 ? "s" : ""}`;
    }

    function initializeCatalogControls(categoryProducts) {
        if (!categorySizeFilter && !categorySortFilter) {
            return;
        }

        if (categorySizeFilter && categorySizeFilter.dataset.bound !== "true") {
            categorySizeFilter.dataset.bound = "true";
            categorySizeFilter.addEventListener("change", () => renderCatalog(catalogProducts));
        }

        if (categorySortFilter && categorySortFilter.dataset.bound !== "true") {
            categorySortFilter.dataset.bound = "true";
            categorySortFilter.addEventListener("change", () => renderCatalog(catalogProducts));
        }

        if (categorySizeFilter) {
            const previousValue = clean(categorySizeFilter.value);
            const sizes = Array.from(new Set(
                categoryProducts
                    .map((product) => clean(product.taille))
                    .filter(Boolean)
            )).sort((left, right) => left.localeCompare(right, "fr", { numeric: true, sensitivity: "base" }));

            categorySizeFilter.innerHTML = [
                `<option value="">Toutes les tailles</option>`,
                ...sizes.map((size) => `<option value="${escapeAttribute(size)}">${escapeHtml(size)}</option>`)
            ].join("");

            if (sizes.includes(previousValue)) {
                categorySizeFilter.value = previousValue;
            }
        }
    }

    function renderSelection(products) {
        if (!selectionGrid) return;

        const hasSelectionColumn = products.some((product) => Object.prototype.hasOwnProperty.call(product, "selection_moment"));
        let selected = (hasSelectionColumn ? products.filter((product) => isSelected(product.selection_moment)) : products).slice(0, 6);

        if (!selected.length) {
            selected = products.slice(0, 6);
        }

        if (!selected.length) {
            selectionGrid.innerHTML = `<p class="catalog-empty">La sélection du moment arrive bientôt.</p>`;
            return;
        }

        selectionGrid.innerHTML = selected.map(miniCard).join("");
    }

    function renderProductDetail(products) {
        if (!productDetail) return;

        const params = new URLSearchParams(window.location.search);
        const productId = clean(params.get("id"));
        if (!productId) {
            productDetail.innerHTML = `<p class="catalog-empty">Aucun article selectionne.</p>`;
            return;
        }

        const product = products.find((item) => clean(item.id) === productId);
        if (!product) {
            productDetail.innerHTML = `<p class="catalog-empty">Cet article est introuvable ou n'est plus disponible.</p>`;
            return;
        }

        productDetail.innerHTML = detailView(product);
        document.title = `${product.nom} - La Goutte de Mer Shop`;
        if ("requestIdleCallback" in window) {
            window.requestIdleCallback(() => preloadProductDetailGallery(productDetail), { timeout: 1200 });
        } else {
            window.setTimeout(() => preloadProductDetailGallery(productDetail), 180);
        }
    }

    function enableGallery() {
        document.addEventListener("click", (event) => {
            const thumb = closestFromEventTarget(event.target, "[data-photo]");
            if (!thumb) return;

            const card = thumb.closest(".catalog-card, .product-detail-card");
            if (!card) return;
            const image = card.querySelector(".catalog-card__image, .product-detail__image");
            image.src = thumb.dataset.photo;
            card.querySelectorAll(".catalog-card__thumb, .product-detail__thumb").forEach((button) => button.classList.remove("is-active"));
            thumb.classList.add("is-active");
        });

        document.addEventListener("pointerenter", (event) => {
            const thumb = closestFromEventTarget(event.target, "[data-photo]");
            if (!thumb) return;
            preloadImageUrl(thumb.dataset.photo);
        }, true);

        document.addEventListener("focusin", (event) => {
            const thumb = closestFromEventTarget(event.target, "[data-photo]");
            if (!thumb) return;
            preloadImageUrl(thumb.dataset.photo);
        });
    }

    function enableImageFallbacks() {
        document.addEventListener("error", (event) => {
            const image = event.target;
            if (!(image instanceof HTMLImageElement)) return;

            const fallbackPhoto = image.dataset.fallbackPhoto;
            if (!fallbackPhoto || image.dataset.fallbackApplied === "true") return;

            image.dataset.fallbackApplied = "true";
            image.src = fallbackPhoto;
        }, true);
    }

    function setupCart() {
        const headerCart = document.querySelector(".header-actions a[aria-label='Panier']");
        const cartButton = document.createElement("button");
        const backdrop = document.createElement("div");
        const panel = document.createElement("aside");

        cartButton.className = "cart-floating-button";
        cartButton.type = "button";
        cartButton.setAttribute("aria-label", "Ouvrir le panier");
        cartButton.innerHTML = `
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 8h12l1 13H5L6 8Zm3 0V6a3 3 0 0 1 6 0v2"/></svg>
            <span data-cart-count>0</span>
        `;

        backdrop.className = "cart-backdrop";
        panel.className = "cart-panel";
        panel.setAttribute("aria-label", "Panier");
        panel.innerHTML = `
            <div class="cart-panel__head">
                <h2>Panier</h2>
                <button type="button" data-cart-close aria-label="Fermer le panier">&times;</button>
            </div>
            <div class="cart-panel__items" data-cart-items></div>
            <div class="cart-panel__footer">
                <div class="cart-panel__total">
                    <span>Total</span>
                    <strong data-cart-total>0,00 EUR</strong>
                </div>
                <div class="cart-panel__actions cart-panel__actions--double">
                    <button type="button" data-cart-clear>Vider</button>
                    <button type="button" data-cart-checkout class="cart-panel__primary">Valider le panier</button>
                </div>
            </div>
        `;

        document.body.appendChild(cartButton);
        document.body.appendChild(backdrop);
        document.body.appendChild(panel);

        if (headerCart) {
            headerCart.classList.add("header-cart-link");
            headerCart.insertAdjacentHTML("beforeend", `<span class="header-cart-count" data-cart-count>0</span>`);
            headerCart.addEventListener("click", (event) => {
                event.preventDefault();
                openCart();
            });
        }

        cartElements = {
            cartButton,
            backdrop,
            panel,
            items: panel.querySelector("[data-cart-items]"),
            total: panel.querySelector("[data-cart-total]"),
            clearButton: panel.querySelector("[data-cart-clear]"),
            checkoutButton: panel.querySelector("[data-cart-checkout]")
        };

        cartButton.addEventListener("click", openCart);
        backdrop.addEventListener("click", closeCart);
        panel.querySelector("[data-cart-close]").addEventListener("click", closeCart);
        cartElements.clearButton.addEventListener("click", () => {
            saveCart([]);
            renderCart();
        });
        cartElements.checkoutButton.addEventListener("click", openCheckout);

        cartElements.items.addEventListener("click", (event) => {
            const removeButton = closestFromEventTarget(event.target, "[data-remove-cart-item]");
            if (!removeButton) return;
            const items = loadCart().filter((item) => item.id !== removeButton.dataset.removeCartItem);
            saveCart(items);
            renderCart();
        });

        document.addEventListener("click", (event) => {
            const addButton = closestFromEventTarget(event.target, "[data-add-to-cart]");
            if (!addButton) return;
            if (addButton.disabled || addButton.dataset.unavailable === "true") return;

            addToCart({
                id: addButton.dataset.id,
                name: addButton.dataset.name,
                price: addButton.dataset.price,
                category: addButton.dataset.category,
                image: addButton.dataset.image,
                size: addButton.dataset.size
            });

            addButton.textContent = "Dans le panier";
            window.setTimeout(() => {
                addButton.textContent = "Ajouter au panier";
            }, 1200);
        });

        document.addEventListener("keydown", (event) => {
            if (event.key === "Escape") {
                closeCheckout();
                closeCart();
            }
        });

        renderCart();
    }

    function setupCheckout() {
        const backdrop = document.createElement("div");
        const panel = document.createElement("aside");

        backdrop.className = "checkout-backdrop";
        panel.className = "checkout-panel";
        panel.setAttribute("aria-label", "Validation de commande");
        panel.innerHTML = `
            <div class="checkout-panel__head">
                <div>
                    <p class="checkout-panel__eyebrow">Paiement et emails</p>
                    <h2>Finaliser la commande</h2>
                </div>
                <button type="button" data-checkout-close aria-label="Fermer">&times;</button>
            </div>
            <div class="checkout-panel__body">
                <form class="checkout-form" data-checkout-form>
                    <div class="checkout-form__grid">
                        <label>
                            <span>Pr&eacute;nom</span>
                            <input type="text" name="firstName" required>
                        </label>
                        <label>
                            <span>Nom</span>
                            <input type="text" name="lastName" required>
                        </label>
                        <label>
                            <span>Email</span>
                            <input type="email" name="email" required>
                        </label>
                        <label>
                            <span>T&eacute;l&eacute;phone</span>
                            <input type="tel" name="phone" required>
                        </label>
                        <label class="checkout-form__full">
                            <span>Adresse</span>
                            <input type="text" name="addressLine1" required>
                        </label>
                        <label>
                            <span>Code postal</span>
                            <input type="text" name="postalCode" required>
                        </label>
                        <label>
                            <span>Ville</span>
                            <input type="text" name="city" required>
                        </label>
                        <label class="checkout-form__full">
                            <span>Message vendeur</span>
                            <textarea name="customerNote" rows="3" placeholder="Pr&eacute;cision de livraison, demande particuli&egrave;re, cr&eacute;neau..."></textarea>
                        </label>
                    </div>
                    <div class="checkout-methods" data-checkout-methods>
                        <div class="checkout-shipping" data-checkout-shipping>
                            <h3>Mode de livraison</h3>
                            <div class="checkout-shipping__list" data-shipping-options></div>
                            <p class="checkout-shipping__feedback" data-shipping-feedback></p>
                            <details class="shipping-international" data-shipping-international-disclosure>
                                <summary class="shipping-international__summary">Livraison hors France</summary>
                                <div class="shipping-international__body">
                                    <p class="shipping-international__text">Choisissez un pays de destination pour afficher les modes de livraison internationaux.</p>
                                    <label class="shipping-international__field">
                                        <span>Pays de livraison</span>
                                        <select name="country" required>
                                            <option value="FR" selected>France</option>
                                            <option value="BE">Belgique</option>
                                            <option value="DE">Allemagne</option>
                                            <option value="ES">Espagne</option>
                                            <option value="IT">Italie</option>
                                            <option value="NL">Pays-Bas</option>
                                            <option value="LU">Luxembourg</option>
                                            <option value="PT">Portugal</option>
                                            <option value="IE">Irlande</option>
                                            <option value="AT">Autriche</option>
                                            <option value="CH">Suisse</option>
                                            <option value="GB">Royaume-Uni</option>
                                            <option value="US">Etats-Unis</option>
                                            <option value="CA">Canada</option>
                                        </select>
                                    </label>
                                </div>
                            </details>
                        </div>
                        <h3>Mode de paiement</h3>
                        <div class="checkout-methods__list" data-payment-methods></div>
                    </div>
                    <section class="checkout-stripe" data-checkout-stripe hidden>
                        <div class="checkout-stripe__surface">
                            <div class="checkout-stripe__element" data-stripe-payment-element></div>
                        </div>
                        <p class="checkout-stripe__note" data-stripe-payment-note></p>
                    </section>
                    <div class="checkout-summary">
                        <h3>R&eacute;capitulatif</h3>
                        <div class="checkout-summary__items" data-checkout-items></div>
                        <div class="checkout-promo">
                            <label class="checkout-promo__label">
                                <span>Code promo</span>
                                <div class="checkout-promo__controls">
                                    <input type="text" name="promoCode" placeholder="Entrez votre code promo">
                                    <button type="button" class="checkout-promo__button" data-apply-promo>Appliquer</button>
                                </div>
                            </label>
                            <p class="checkout-promo__feedback" data-promo-feedback></p>
                        </div>
                        <div class="checkout-summary__line">
                            <span>Sous-total</span>
                            <strong data-checkout-subtotal>0,00 EUR</strong>
                        </div>
                        <div class="checkout-summary__line" data-checkout-promo-line hidden>
                            <span>Code promo</span>
                            <strong data-checkout-promo-total>-0,00 EUR</strong>
                        </div>
                        <div class="checkout-summary__line">
                            <span>Livraison</span>
                            <strong data-checkout-shipping-total>A calculer</strong>
                        </div>
                        <div class="checkout-summary__total">
                            <span>Total</span>
                            <strong data-checkout-total>0,00 EUR</strong>
                        </div>
                    </div>
                    <p class="checkout-feedback" data-checkout-feedback></p>
                    <div class="checkout-actions">
                        <button type="button" class="checkout-actions__secondary" data-checkout-cancel>Retour au panier</button>
                        <button type="submit" class="checkout-actions__primary">Valider et payer</button>
                    </div>
                </form>
                <section class="checkout-success" data-checkout-success hidden>
                    <p class="checkout-panel__eyebrow">Commande pr&ecirc;te</p>
                    <h3>Emails et facture</h3>
                    <p data-checkout-success-text></p>
                    <div class="checkout-success__meta" data-checkout-success-meta></div>
                    <div class="checkout-success__actions">
                        <button type="button" class="checkout-actions__secondary" data-close-success>Fermer</button>
                        <a href="#" target="_blank" rel="noopener" data-pay-now aria-disabled="true">Payer maintenant</a>
                    </div>
                </section>
            </div>
        `;

        document.body.appendChild(backdrop);
        document.body.appendChild(panel);

        checkoutElements = {
            backdrop,
            panel,
            form: panel.querySelector("[data-checkout-form]"),
            methodsSection: panel.querySelector("[data-checkout-methods]"),
            shippingSection: panel.querySelector("[data-checkout-shipping]"),
            shippingOptions: panel.querySelector("[data-shipping-options]"),
            shippingFeedback: panel.querySelector("[data-shipping-feedback]"),
            shippingInternationalDisclosure: panel.querySelector("[data-shipping-international-disclosure]"),
            paymentMethods: panel.querySelector("[data-payment-methods]"),
            stripeSection: panel.querySelector("[data-checkout-stripe]"),
            stripeMount: panel.querySelector("[data-stripe-payment-element]"),
            stripeNote: panel.querySelector("[data-stripe-payment-note]"),
            items: panel.querySelector("[data-checkout-items]"),
            promoInput: panel.querySelector("input[name='promoCode']"),
            promoApplyButton: panel.querySelector("[data-apply-promo]"),
            promoFeedback: panel.querySelector("[data-promo-feedback]"),
            subtotal: panel.querySelector("[data-checkout-subtotal]"),
            promoLine: panel.querySelector("[data-checkout-promo-line]"),
            promoTotal: panel.querySelector("[data-checkout-promo-total]"),
            shippingTotal: panel.querySelector("[data-checkout-shipping-total]"),
            total: panel.querySelector("[data-checkout-total]"),
            feedback: panel.querySelector("[data-checkout-feedback]"),
            success: panel.querySelector("[data-checkout-success]"),
            successText: panel.querySelector("[data-checkout-success-text]"),
            successMeta: panel.querySelector("[data-checkout-success-meta]"),
            payNow: panel.querySelector("[data-pay-now]"),
            submitButton: panel.querySelector(".checkout-actions__primary")
        };

        checkoutElements.stripeSection.hidden = false;
        checkoutElements.methodsSection.appendChild(checkoutElements.stripeSection);
        renderPaymentMethods();
        syncCheckoutPaymentUi();

        backdrop.addEventListener("click", closeCheckout);
        panel.querySelector("[data-checkout-close]").addEventListener("click", closeCheckout);
        panel.querySelector("[data-checkout-cancel]").addEventListener("click", closeCheckout);
        panel.querySelector("[data-close-success]").addEventListener("click", closeCheckout);
        checkoutElements.form.addEventListener("change", handleCheckoutFormChange);
        checkoutElements.form.addEventListener("input", handleCheckoutFormChange);
        checkoutElements.form.addEventListener("focusout", handleCheckoutFormChange);
        checkoutElements.form.addEventListener("click", handleCheckoutFormClick);
        checkoutElements.form.addEventListener("submit", handleCheckoutSubmit);

    }

    function paymentLogoMarkup(method) {
        return `<img class="payment-method__logo" src="${escapeAttribute(method.logo)}" alt="${escapeAttribute(method.label)}">`;
    }

    function paymentBadgesMarkup(method) {
        const badges = Array.isArray(method.supportedMethods) ? method.supportedMethods : [];
        if (!badges.length) {
            return "";
        }

        return `
            <span class="payment-method__badges">
                ${badges.map((badge) => paymentBadgeVisualMarkup(badge)).join("")}
            </span>
        `;
    }

    function paymentBadgeVisualMarkup(badge) {
        const key = clean(badge).toLowerCase();

        if (key === "visa") {
            return `
                <span class="payment-method__badge payment-method__badge--brand" aria-label="Visa">
                    <img class="payment-method__badge-logo" src="assets/images/payment-visa.svg" alt="Visa">
                </span>
            `;
        }

        if (key === "mastercard") {
            return `
                <span class="payment-method__badge payment-method__badge--brand" aria-label="Mastercard">
                    <img class="payment-method__badge-logo" src="assets/images/payment-mastercard.svg" alt="Mastercard">
                </span>
            `;
        }

        if (key === "klarna") {
            return `
                <span class="payment-method__badge payment-method__badge--brand" aria-label="Klarna">
                    <img class="payment-method__badge-logo" src="assets/images/payment-klarna.svg" alt="Klarna">
                </span>
            `;
        }

        if (key === "cb") {
            return `
                <span class="payment-method__badge payment-method__badge--brand" aria-label="Carte Bancaire">
                    <img class="payment-method__badge-logo" src="assets/images/payment-cb.svg" alt="CB">
                </span>
            `;
        }

        return `<span class="payment-method__badge">${escapeHtml(badge)}</span>`;
    }

    function renderPaymentMethods() {
        const methods = getAvailablePaymentMethods();
        checkoutElements.paymentMethods.innerHTML = methods.map((method, index) => `
            <label class="payment-method${isPaymentMethodReady(method) ? "" : " payment-method--pending"} payment-method--${escapeAttribute(method.id)}">
                <input type="radio" name="paymentMethod" value="${escapeAttribute(method.id)}" ${index === 0 ? "checked" : ""}>
                <span class="payment-method__content">
                    <span class="payment-method__brand">
                        ${paymentLogoMarkup(method)}
                    </span>
                    <span class="payment-method__meta">
                        <strong class="payment-method__title">${escapeHtml(method.label)}</strong>
                        ${method.secureLabel ? `<small>${escapeHtml(method.secureLabel)}</small>` : ""}
                        ${paymentBadgesMarkup(method)}
                    </span>
                </span>
            </label>
        `).join("");
    }

    function resetCheckoutShippingState() {
        window.clearTimeout(checkoutShippingUpdateTimer);
        checkoutShippingUpdateTimer = 0;
        checkoutShippingState = {
            options: [],
            selectedOptionId: "",
            servicePointPicker: {
                enabled: false,
                publicKey: ""
            },
            servicePointSelections: {},
            loading: false,
            error: ""
        };
        renderShippingOptions();
    }

    function resetCheckoutPromotionState() {
        checkoutPromotionState = {
            code: "",
            promotion: null,
            loading: false,
            error: ""
        };

        if (checkoutElements?.promoInput) {
            checkoutElements.promoInput.value = "";
        }
        renderPromotionFeedback();
    }

    function scheduleCheckoutShippingRefresh() {
        window.clearTimeout(checkoutShippingUpdateTimer);
        checkoutShippingUpdateTimer = window.setTimeout(() => {
            updateCheckoutShippingOptions();
        }, 250);
    }

    async function updateCheckoutShippingOptions() {
        if (!checkoutElements?.form || !shopConfig.backend.baseUrl) {
            return;
        }

        const items = loadCart();
        if (!items.length) return;

        const customer = collectCheckoutCustomer(false);
        const requestId = ++checkoutShippingRequestId;
        checkoutShippingState.loading = true;
        checkoutShippingState.error = "";
        renderShippingOptions();

        try {
            const response = await fetch(`${shopConfig.backend.baseUrl}/api/shipping/options`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    cart: items.map((item) => ({
                        id: item.id,
                        quantity: 1,
                        price: item.price,
                        unitAmount: parsePrice(item.price)
                    })),
                    customer
                })
            });

            const payload = await response.json().catch(() => ({}));
            if (!response.ok) {
                throw new Error(payload?.error?.message || "Impossible de charger les modes de livraison.");
            }

            if (requestId !== checkoutShippingRequestId) {
                return;
            }

            checkoutShippingState.options = Array.isArray(payload.options) ? payload.options : [];
            checkoutShippingState.servicePointPicker = {
                enabled: Boolean(payload?.servicePointPicker?.enabled),
                publicKey: clean(payload?.servicePointPicker?.publicKey)
            };
            if (!checkoutShippingState.options.length) {
                throw new Error("Aucun mode de livraison disponible pour cette adresse.");
            }

            const sortedOptions = getSortedShippingOptions(checkoutShippingState.options);
            const stillExists = sortedOptions.some((option) => option.id === checkoutShippingState.selectedOptionId);
            if (!stillExists) {
                checkoutShippingState.selectedOptionId = sortedOptions[0].id;
            }
            checkoutShippingState.servicePointSelections = Object.fromEntries(
                Object.entries(checkoutShippingState.servicePointSelections).filter(([optionId]) => (
                    checkoutShippingState.options.some((option) => option.id === optionId)
                ))
            );
            if (checkoutElements.feedback.textContent === "Choisissez un mode de livraison.") {
                checkoutElements.feedback.textContent = "";
            }
        } catch (error) {
            if (requestId !== checkoutShippingRequestId) {
                return;
            }
            checkoutShippingState.options = [];
            checkoutShippingState.selectedOptionId = "";
            checkoutShippingState.error = error.message || "Impossible de charger les modes de livraison.";
        } finally {
            if (requestId !== checkoutShippingRequestId) {
                return;
            }
            checkoutShippingState.loading = false;
            renderShippingOptions();
            renderCheckoutSummary(items);
            syncCheckoutPaymentUi();
            if (getSelectedPaymentMethodId() === "stripe" && hasValidCheckoutCustomerDetails() && getSelectedShippingOptionId()) {
                scheduleStripeAutofillCheck(20);
            }
        }
    }

    function getShippingOptionDisplayOrder(option) {
        const optionId = clean(option?.id);
        const priorityMap = {
            "colissimo-relay": 0,
            "mondial-relay": 1,
            "chronopost-relay": 2,
            "colissimo-home": 3,
            "chronopost-home": 4
        };

        return priorityMap[optionId] ?? 99;
    }

    function getSortedShippingOptions(options = checkoutShippingState.options) {
        return [...options].sort((left, right) => {
            return getShippingOptionDisplayOrder(left) - getShippingOptionDisplayOrder(right);
        });
    }

    function renderShippingOptions() {
        if (!checkoutElements?.shippingOptions || !checkoutElements?.shippingFeedback) {
            return;
        }

        syncInternationalShippingDisclosure();

        if (checkoutElements.submitButton) {
            const isSubmitBlocked = checkoutShippingState.loading || Boolean(checkoutShippingState.error) || !checkoutShippingState.options.length;
            checkoutElements.submitButton.disabled = isSubmitBlocked;
        }

        if (checkoutShippingState.loading) {
            checkoutElements.shippingFeedback.textContent = checkoutShippingState.options.length
                ? ""
                : "Chargement des modes de livraison...";
            return;
        }

        if (checkoutShippingState.error) {
            checkoutElements.shippingOptions.innerHTML = "";
            checkoutElements.shippingFeedback.textContent = checkoutShippingState.error;
            return;
        }

        const options = getSortedShippingOptions();
        checkoutElements.shippingFeedback.textContent = "";
        checkoutElements.shippingOptions.innerHTML = options.map((option, index) => `
            <label class="shipping-option">
                <input type="radio" name="shippingOption" value="${escapeAttribute(option.id)}" ${option.id === checkoutShippingState.selectedOptionId || (!checkoutShippingState.selectedOptionId && index === 0) ? "checked" : ""}>
                <span class="shipping-option__content">
                    <span class="shipping-option__main">
                        <strong>${escapeHtml(option.label)}</strong>
                        ${option.description && !option.requiresServicePoint ? `<small>${escapeHtml(option.description)}</small>` : ""}
                        ${option.estimatedLabel ? `<small>${escapeHtml(option.estimatedLabel)}</small>` : ""}
                        ${option.requiresServicePoint ? renderServicePointSelectionMarkup(option) : ""}
                    </span>
                    <span class="shipping-option__price">${option.shippingAmount <= 0 ? "Offerte" : escapeHtml(formatPrice(option.shippingAmount))}</span>
                </span>
            </label>
        `).join("");

        const selectedOption = getSelectedShippingOption();
        if (selectedOption?.requiresServicePoint && !getSelectedServicePoint(selectedOption.id)) {
            checkoutElements.shippingFeedback.textContent = "Choisissez un point relais pour continuer le paiement.";
        }
    }

    function syncInternationalShippingDisclosure() {
        const disclosure = checkoutElements?.shippingInternationalDisclosure;
        const country = collectCheckoutCustomer(false).country || "FR";
        if (!disclosure) {
            return;
        }

        if (country !== "FR") {
            disclosure.open = true;
            return;
        }

        if (!disclosure.dataset.userOpened) {
            disclosure.open = false;
        }
    }

    function getSelectedShippingOptionId() {
        return checkoutElements?.form?.querySelector("input[name='shippingOption']:checked")?.value
            || checkoutShippingState.selectedOptionId
            || "";
    }

    function getSelectedShippingOption() {
        const selectedId = getSelectedShippingOptionId();
        return checkoutShippingState.options.find((option) => option.id === selectedId) || null;
    }

    function getSelectedServicePoint(optionId = getSelectedShippingOptionId()) {
        return checkoutShippingState.servicePointSelections[clean(optionId)] || null;
    }

    function renderServicePointSelectionMarkup(option) {
        const selectedServicePoint = getSelectedServicePoint(option.id);
        const isSelectedOption = option.id === getSelectedShippingOptionId();
        const pickerUnavailable = !checkoutShippingState.servicePointPicker.enabled || !checkoutShippingState.servicePointPicker.publicKey;
        const actionLabel = selectedServicePoint ? "Changer le point relais" : "Choisir un point relais";

        return `
            <span class="shipping-option__relay${isSelectedOption ? " shipping-option__relay--active" : ""}">
                ${selectedServicePoint ? `
                    <span class="shipping-option__relay-summary">
                        <strong>${escapeHtml(selectedServicePoint.name || "Point relais selectionne")}</strong>
                        <small>${escapeHtml(formatServicePointAddress(selectedServicePoint))}</small>
                    </span>
                ` : ""}
                <span class="shipping-option__relay-actions">
                    <button
                        type="button"
                        class="shipping-option__relay-button"
                        data-open-service-point-picker
                        data-shipping-option-id="${escapeAttribute(option.id)}"
                        ${pickerUnavailable ? "disabled" : ""}
                    >${escapeHtml(actionLabel)}</button>
                    ${pickerUnavailable ? `<small>Le sélecteur Sendcloud n'est pas encore configuré.</small>` : ""}
                </span>
            </span>
        `;
    }

    function formatServicePointAddress(servicePoint) {
        return [
            [clean(servicePoint.street), clean(servicePoint.houseNumber)].filter(Boolean).join(" ").trim(),
            [clean(servicePoint.postalCode), clean(servicePoint.city)].filter(Boolean).join(" ").trim()
        ].filter(Boolean).join(", ");
    }

    function handleCheckoutFormChange(event) {
        if (event.target instanceof HTMLInputElement && event.target.name === "paymentMethod") {
            syncCheckoutPaymentUi();
        }

        if (event.target instanceof HTMLInputElement && event.target.name === "shippingOption") {
            checkoutShippingState.selectedOptionId = clean(event.target.value);
            checkoutElements.feedback.textContent = "";
            renderCheckoutSummary(loadCart());
            syncCheckoutPaymentUi();
            if (getSelectedPaymentMethodId() === "stripe") {
                scheduleStripeAutofillCheck();
            }
            return;
        }

        if (event.target instanceof HTMLInputElement && event.target.name === "promoCode") {
            const nextCode = normalizePromoCode(event.target.value);
            checkoutPromotionState.code = nextCode;
            if (!nextCode) {
                checkoutPromotionState.promotion = null;
                checkoutPromotionState.error = "";
            } else if (checkoutPromotionState.promotion?.code !== nextCode) {
                checkoutPromotionState.promotion = null;
                checkoutPromotionState.error = "";
            }
            renderPromotionFeedback();
            renderCheckoutSummary(loadCart());
            return;
        }

        if (event.target instanceof HTMLSelectElement && event.target.name === "country") {
            const disclosure = checkoutElements?.shippingInternationalDisclosure;
            if (disclosure) {
                disclosure.dataset.userOpened = event.target.value === "FR" ? "" : "true";
            }
        }

        if (
            (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement)
            && !(event.target instanceof HTMLInputElement && event.target.name === "paymentMethod")
        ) {
            scheduleCheckoutShippingRefresh();
        }

        if (getSelectedPaymentMethodId() === "stripe") {
            scheduleStripeAutofillCheck();
        }
    }

    function handleCheckoutFormClick(event) {
        const disclosureTrigger = closestFromEventTarget(event.target, ".shipping-international__summary");
        if (disclosureTrigger && checkoutElements?.shippingInternationalDisclosure) {
            checkoutElements.shippingInternationalDisclosure.dataset.userOpened = "true";
        }

        const trigger = closestFromEventTarget(event.target, "[data-open-service-point-picker]");
        if (trigger) {
            event.preventDefault();
            const optionId = clean(trigger.dataset.shippingOptionId);
            if (!optionId) {
                return;
            }

            const optionInput = checkoutElements?.form?.querySelector(`input[name='shippingOption'][value="${CSS.escape(optionId)}"]`);
            if (optionInput instanceof HTMLInputElement) {
                optionInput.checked = true;
                checkoutShippingState.selectedOptionId = optionId;
            }

            checkoutElements.feedback.textContent = "";
            renderCheckoutSummary(loadCart());
            syncCheckoutPaymentUi();
            void openSelectedServicePointPicker(optionId);
            return;
        }

        const promoTrigger = closestFromEventTarget(event.target, "[data-apply-promo]");
        if (promoTrigger) {
            event.preventDefault();
            void applyPromotionCode();
        }
    }

    function getSelectedPaymentMethodId() {
        return checkoutElements?.form?.querySelector("input[name='paymentMethod']:checked")?.value || "";
    }

    function getSelectedPaymentMethod() {
        return getAvailablePaymentMethods().find((method) => method.id === getSelectedPaymentMethodId()) || null;
    }

    async function applyPromotionCode() {
        if (!checkoutElements?.promoInput || !shopConfig.backend.baseUrl) {
            return;
        }

        const items = loadCart();
        const promoCode = normalizePromoCode(checkoutElements.promoInput.value);
        checkoutPromotionState.code = promoCode;

        if (!promoCode) {
            checkoutPromotionState.promotion = null;
            checkoutPromotionState.error = "";
            currentOrder = null;
            clearPendingPayPalOrder();
            clearPendingStripeSession();
            resetStripeCheckoutState();
            renderPromotionFeedback();
            renderCheckoutSummary(items);
            syncCheckoutPaymentUi();
            if (getSelectedPaymentMethodId() === "stripe" && hasValidCheckoutCustomerDetails() && isShippingSelectionComplete()) {
                void maybeAutoInitializeStripe();
            }
            return;
        }

        checkoutPromotionState.loading = true;
        checkoutPromotionState.error = "";
        renderPromotionFeedback();

        try {
            const response = await fetch(`${shopConfig.backend.baseUrl}/api/promotions/validate`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    promoCode,
                    cart: items.map((item) => ({
                        id: item.id,
                        quantity: 1,
                        price: item.price,
                        unitAmount: parsePrice(item.price)
                    }))
                })
            });

            const payload = await response.json().catch(() => ({}));
            if (!response.ok || !payload?.promotion) {
                throw new Error(payload?.error?.message || "Code promo erroné.");
            }

            checkoutPromotionState.promotion = payload.promotion;
            checkoutPromotionState.code = normalizePromoCode(payload.promotion.code);
            if (checkoutElements?.promoInput) {
                checkoutElements.promoInput.value = checkoutPromotionState.code;
            }
            checkoutPromotionState.error = "";
            currentOrder = null;
            clearPendingPayPalOrder();
            clearPendingStripeSession();
            resetStripeCheckoutState();
        } catch (error) {
            checkoutPromotionState.promotion = null;
            checkoutPromotionState.error = error.message || "Code promo erroné.";
        } finally {
            checkoutPromotionState.loading = false;
            renderPromotionFeedback();
            renderCheckoutSummary(items);
            syncCheckoutPaymentUi();
            if (!checkoutPromotionState.error && getSelectedPaymentMethodId() === "stripe" && hasValidCheckoutCustomerDetails() && isShippingSelectionComplete()) {
                void maybeAutoInitializeStripe();
            }
        }
    }

    function syncCheckoutPaymentUi() {
        if (!checkoutElements) return;

        const method = getSelectedPaymentMethod();
        const isStripe = method?.id === "stripe";
        const isPayPal = method?.id === "paypal";
        const customerReady = hasValidCheckoutCustomerDetails();
        const shippingReady = isShippingSelectionComplete();
        const stripeRefreshing = isStripe && Boolean(stripeMountingSignature);
        const shouldShowStripePanel = customerReady && isStripe && stripeCheckoutMode !== "redirect";
        checkoutElements.paymentMethods.querySelectorAll(".payment-method").forEach((card) => {
            const input = card.querySelector("input[name='paymentMethod']");
            card.classList.toggle("payment-method--active", Boolean(input?.checked));
        });

        checkoutElements.methodsSection.classList.toggle("checkout-methods--ready", customerReady);
        checkoutElements.methodsSection.setAttribute("aria-hidden", customerReady ? "false" : "true");
        checkoutElements.stripeSection.classList.toggle("checkout-stripe--open", shouldShowStripePanel);
        checkoutElements.stripeSection.setAttribute("aria-hidden", shouldShowStripePanel ? "false" : "true");

        if (!customerReady) {
            setCheckoutSubmitLabel("Compl\u00e9ter vos informations");
            checkoutElements.submitButton.disabled = true;
            checkoutElements.stripeNote.textContent = "";
            return;
        }

        if (isPayPal) {
            setCheckoutSubmitLabel("Payer avec PayPal");
            checkoutElements.submitButton.disabled = !shippingReady;
            checkoutElements.stripeNote.textContent = "";
            return;
        }

        if (!isStripe) {
            setCheckoutSubmitLabel("Valider et payer");
            checkoutElements.submitButton.disabled = !shippingReady;
            checkoutElements.stripeNote.textContent = "";
            return;
        }

        if (stripeCheckoutMode === "redirect") {
            setCheckoutSubmitLabel("Payer avec Stripe");
            checkoutElements.submitButton.disabled = !shippingReady;
            checkoutElements.stripeNote.textContent = "";
            return;
        }

        if (stripeRefreshing) {
            setCheckoutSubmitLabel("Payer avec Stripe");
            checkoutElements.submitButton.disabled = true;
            checkoutElements.stripeNote.textContent = "";
            return;
        }

        if (!stripeCheckoutState?.actions) {
            setCheckoutSubmitLabel("Payer avec Stripe");
            checkoutElements.submitButton.disabled = !shippingReady;
            checkoutElements.stripeNote.textContent = shippingReady ? "" : checkoutReadinessMessage();
            return;
        }

        setCheckoutSubmitLabel("Payer avec Stripe");
        checkoutElements.submitButton.disabled = !shippingReady || stripeCheckoutState.canConfirm === false;
        checkoutElements.stripeNote.textContent = "";
    }

    function checkoutReadinessMessage() {
        const selectedOption = getSelectedShippingOption();
        if (!selectedOption) {
            return "Choisissez d'abord un mode de livraison.";
        }

        if (selectedOption.requiresServicePoint && !getSelectedServicePoint(selectedOption.id)) {
            return "Choisissez d'abord votre point relais.";
        }

        if (checkoutShippingState.loading) {
            return "Les modes de livraison sont en cours de mise a jour.";
        }

        return "";
    }

    function isShippingSelectionComplete() {
        const selectedOption = getSelectedShippingOption();
        if (!selectedOption || checkoutShippingState.loading || checkoutShippingState.error) {
            return false;
        }

        if (selectedOption.requiresServicePoint) {
            return Boolean(getSelectedServicePoint(selectedOption.id));
        }

        return true;
    }

    function setCheckoutSubmitLabel(label) {
        if (checkoutElements?.submitButton) {
            checkoutElements.submitButton.textContent = label;
        }
    }

    function hasCompleteCheckoutCustomer(customer) {
        return Boolean(
            customer
            && customer.firstName
            && customer.lastName
            && customer.email
            && customer.phone
            && customer.addressLine1
            && customer.postalCode
            && customer.city
        );
    }

    function hasValidCheckoutCustomerDetails() {
        if (!checkoutElements?.form) return false;

        const requiredFields = ["firstName", "lastName", "email", "phone", "addressLine1", "postalCode", "city"];
        return requiredFields.every((name) => {
            const field = checkoutElements.form.elements.namedItem(name);
            return field instanceof HTMLInputElement && field.checkValidity() && Boolean(clean(field.value));
        });
    }

    function checkoutSignature(items, customer) {
        return JSON.stringify({
            items: items.map((item) => ({
                id: clean(item.id),
                price: parsePrice(item.price)
            })),
            promoCode: normalizePromoCode(checkoutElements?.promoInput?.value),
            customer: {
                firstName: clean(customer.firstName),
                lastName: clean(customer.lastName),
                email: clean(customer.email),
                phone: clean(customer.phone),
                addressLine1: clean(customer.addressLine1),
                postalCode: clean(customer.postalCode),
                city: clean(customer.city),
                country: clean(customer.country)
            },
            shippingOptionId: getSelectedShippingOptionId()
        });
    }

    function collectCheckoutCustomer(includeNote = true) {
        if (!checkoutElements?.form) {
            return {
                firstName: "",
                lastName: "",
                email: "",
                phone: "",
                addressLine1: "",
                postalCode: "",
                city: "",
                country: "FR",
                customerNote: ""
            };
        }

        const formData = new FormData(checkoutElements.form);
        return {
            firstName: clean(formData.get("firstName")),
            lastName: clean(formData.get("lastName")),
            email: clean(formData.get("email")),
            phone: clean(formData.get("phone")),
            addressLine1: clean(formData.get("addressLine1")),
            postalCode: clean(formData.get("postalCode")),
            city: clean(formData.get("city")),
            country: clean(formData.get("country")).toUpperCase() || "FR",
            customerNote: includeNote ? clean(formData.get("customerNote")) : ""
        };
    }

    function sendcloudPickerLanguage() {
        return document.documentElement.lang?.toLowerCase().startsWith("fr") ? "fr-fr" : "en-us";
    }

    function loadSendcloudServicePointSdk() {
        if (window.sendcloud?.servicePoints?.open) {
            return Promise.resolve(window.sendcloud);
        }

        if (sendcloudServicePointSdkPromise) {
            return sendcloudServicePointSdkPromise;
        }

        sendcloudServicePointSdkPromise = new Promise((resolve, reject) => {
            const existing = document.querySelector("script[data-sendcloud-spp]");
            if (existing) {
                existing.addEventListener("load", () => resolve(window.sendcloud), { once: true });
                existing.addEventListener("error", () => reject(new Error("Impossible de charger le sélecteur de points relais Sendcloud.")), { once: true });
                return;
            }

            const script = document.createElement("script");
            script.src = "https://embed.sendcloud.sc/spp/1.0.0/api.min.js";
            script.async = true;
            script.dataset.sendcloudSpp = "true";
            script.addEventListener("load", () => resolve(window.sendcloud), { once: true });
            script.addEventListener("error", () => reject(new Error("Impossible de charger le sélecteur de points relais Sendcloud.")), { once: true });
            document.head.appendChild(script);
        });

        return sendcloudServicePointSdkPromise;
    }

    function normalizeServicePointSelection(servicePoint, postNumber = "") {
        const servicePointId = Number.parseInt(clean(servicePoint?.service_point_id ?? servicePoint?.id), 10);
        if (!Number.isFinite(servicePointId) || servicePointId <= 0) {
            return null;
        }

        return {
            servicePointId,
            postNumber: clean(postNumber || servicePoint?.post_number),
            carrier: clean(servicePoint?.carrier),
            name: clean(servicePoint?.name),
            street: clean(servicePoint?.street),
            houseNumber: clean(servicePoint?.house_number ?? servicePoint?.houseNumber),
            postalCode: clean(servicePoint?.postal_code ?? servicePoint?.postalCode),
            city: clean(servicePoint?.city),
            country: clean(servicePoint?.country || "FR").toUpperCase()
        };
    }

    async function openSelectedServicePointPicker(optionId) {
        const option = checkoutShippingState.options.find((entry) => entry.id === clean(optionId));
        if (!option?.requiresServicePoint) {
            return;
        }

        if (!checkoutShippingState.servicePointPicker.enabled || !checkoutShippingState.servicePointPicker.publicKey) {
            checkoutElements.feedback.textContent = "Le sélecteur de points relais Sendcloud n'est pas encore configuré.";
            return;
        }

        const customer = collectCheckoutCustomer(false);
        if (!customer.postalCode || !customer.city) {
            checkoutElements.feedback.textContent = "Renseignez au moins le code postal et la ville avant de choisir un point relais.";
            return;
        }

        checkoutElements.feedback.textContent = "Ouverture du sélecteur de points relais...";

        try {
            await loadSendcloudServicePointSdk();
            const existingSelection = getSelectedServicePoint(option.id);
            const pickerConfig = {
                apiKey: checkoutShippingState.servicePointPicker.publicKey,
                country: clean(customer.country || "FR").toLowerCase(),
                language: sendcloudPickerLanguage(),
                postalCode: customer.postalCode,
                city: customer.city,
                carriers: Array.isArray(option.pickerCarriers) ? option.pickerCarriers.join(",") : "",
                servicePointId: existingSelection?.servicePointId || undefined,
                postNumber: existingSelection?.postNumber || undefined
            };

            await new Promise((resolve, reject) => {
                window.sendcloud.servicePoints.open(
                    pickerConfig,
                    (servicePoint, postNumber) => {
                        const normalized = normalizeServicePointSelection(servicePoint, postNumber);
                        if (!normalized) {
                            reject(new Error("Le point relais selectionne est invalide."));
                            return;
                        }
                        checkoutShippingState.servicePointSelections[option.id] = normalized;
                        resolve(normalized);
                    },
                    (errors) => {
                        if (Array.isArray(errors) && errors.length) {
                            reject(new Error(errors.join(" ")));
                            return;
                        }
                        reject(new Error("Le sélecteur de points relais a été fermé."));
                    }
                );
            });

            checkoutElements.feedback.textContent = "";
            renderShippingOptions();
            renderCheckoutSummary(loadCart());
            syncCheckoutPaymentUi();
            if (getSelectedPaymentMethodId() === "stripe") {
                scheduleStripeAutofillCheck(20);
            }
        } catch (error) {
            checkoutElements.feedback.textContent = error.message || "Impossible d'ouvrir le sélecteur de points relais.";
        }
    }

    function resetStripeCheckoutState() {
        window.clearTimeout(stripeAutofillCheckTimer);
        stripeAutofillCheckTimer = 0;
        destroyStripeCheckoutState(stripeCheckoutState);

        stripeCheckoutState = null;
        stripeMountingSignature = "";
        if (checkoutElements?.stripeMount) {
            checkoutElements.stripeMount.innerHTML = "";
        }
        if (checkoutElements?.stripeNote) {
            checkoutElements.stripeNote.textContent = "";
        }
    }

    function destroyStripeCheckoutState(state) {
        if (!state) {
            return;
        }

        if (state.paymentElement?.destroy) {
            state.paymentElement.destroy();
        } else if (state.paymentElement?.unmount) {
            state.paymentElement.unmount();
        }
    }

    async function ensureStripeClientConfig() {
        if (stripeClientConfig?.publishableKey) {
            stripeCheckoutMode = clean(stripeClientConfig?.checkoutMode).toLowerCase() === "redirect" ? "redirect" : "custom";
            return stripeClientConfig;
        }

        const response = await fetch(`${shopConfig.backend.baseUrl}/api/stripe/config`);
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || !payload.publishableKey) {
            throw new Error(payload?.error?.message || "Cl\u00e9 publique Stripe introuvable.");
        }

        stripeClientConfig = payload;
        stripeCheckoutMode = clean(payload?.checkoutMode).toLowerCase() === "redirect" ? "redirect" : "custom";
        return stripeClientConfig;
    }

    function loadStripeSdk() {
        if (window.Stripe) {
            return Promise.resolve(window.Stripe);
        }

        if (stripeSdkPromise) {
            return stripeSdkPromise;
        }

        stripeSdkPromise = new Promise((resolve, reject) => {
            const existing = document.querySelector("script[data-stripe-sdk]");
            if (existing) {
                existing.addEventListener("load", () => resolve(window.Stripe), { once: true });
                existing.addEventListener("error", () => reject(new Error("Impossible de charger Stripe.js.")), { once: true });
                return;
            }

            const script = document.createElement("script");
            script.src = "https://js.stripe.com/clover/stripe.js";
            script.async = true;
            script.dataset.stripeSdk = "true";
            script.addEventListener("load", () => resolve(window.Stripe), { once: true });
            script.addEventListener("error", () => reject(new Error("Impossible de charger Stripe.js.")), { once: true });
            document.head.appendChild(script);
        });

        return stripeSdkPromise;
    }

    function buildStripeAppearance() {
        return {
            theme: "night",
            variables: {
                colorPrimary: "#c89b4f",
                colorBackground: "#071523",
                colorText: "#f6efe4",
                colorTextSecondary: "#d2c4ab",
                colorDanger: "#f3a99f",
                colorSuccess: "#8fd9b6",
                colorWarning: "#f0d08a",
                colorIcon: "#c89b4f",
                colorTextPlaceholder: "#8f8b84",
                fontFamily: "Montserrat, system-ui, sans-serif",
                spacingUnit: "4px",
                borderRadius: "0px"
            },
            rules: {
                ".Tab": {
                    border: "1px solid rgba(200,155,79,0.22)",
                    backgroundColor: "rgba(6,19,32,0.92)",
                    boxShadow: "none",
                    color: "#f6efe4"
                },
                ".Tab:hover": {
                    color: "#fff7ea",
                    backgroundColor: "rgba(200,155,79,0.08)"
                },
                ".TabLabel": {
                    color: "#f6efe4",
                    fontWeight: "600"
                },
                ".TabIcon": {
                    color: "#f0d08a",
                    fill: "#f0d08a"
                },
                ".Tab--selected": {
                    borderColor: "#c89b4f",
                    backgroundColor: "rgba(200,155,79,0.12)",
                    color: "#fff7ea"
                },
                ".Tab--selected .TabLabel": {
                    color: "#fff7ea"
                },
                ".AccordionItem": {
                    border: "1px solid rgba(200,155,79,0.16)",
                    backgroundColor: "rgba(6,19,32,0.72)",
                    color: "#f6efe4"
                },
                ".AccordionItem .Label": {
                    color: "#f6efe4"
                },
                ".Input": {
                    border: "1px solid rgba(200,155,79,0.28)",
                    backgroundColor: "rgba(4,14,24,0.94)",
                    boxShadow: "none"
                },
                ".Input:focus": {
                    borderColor: "#c89b4f",
                    boxShadow: "0 0 0 1px rgba(200,155,79,0.42)"
                },
                ".Label": {
                    color: "#f6efe4",
                    fontWeight: "500"
                }
            }
        };
    }

    function stripePaymentElementLayout() {
        if (window.matchMedia?.("(max-width: 720px)").matches) {
            return {
                type: "accordion",
                defaultCollapsed: false,
                radios: true
            };
        }

        return {
            type: "tabs",
            defaultCollapsed: false
        };
    }

    function scheduleStripeAutofillCheck(delay = 60) {
        if (getSelectedPaymentMethodId() !== "stripe") {
            window.clearTimeout(stripeAutofillCheckTimer);
            stripeAutofillCheckTimer = 0;
            return;
        }

        window.clearTimeout(stripeAutofillCheckTimer);
        stripeAutofillCheckTimer = window.setTimeout(() => {
            stripeAutofillCheckTimer = 0;
            void maybeAutoInitializeStripe();
        }, delay);
    }

    function queueStripeAutofillRefresh() {
        [80, 220, 450, 900].forEach((delay) => {
            window.setTimeout(() => {
                if (document.body.classList.contains("checkout-is-open") && getSelectedPaymentMethodId() === "stripe") {
                    scheduleStripeAutofillCheck();
                }
            }, delay);
        });
    }

    async function mountStripePaymentElement(remoteSession, items, customer) {
        const previousStripeState = stripeCheckoutState;
        const stripeLoader = await loadStripeSdk();
        const stripeConfig = await ensureStripeClientConfig();
        const stripe = stripeLoader(stripeConfig.publishableKey, {
            developerTools: {
                assistant: {
                    enabled: false
                }
            }
        });
        const checkout = await stripe.initCheckout({
            clientSecret: remoteSession.clientSecret,
            elementsOptions: {
                appearance: buildStripeAppearance()
            }
        });

        destroyStripeCheckoutState(previousStripeState);
        checkoutElements.stripeMount.innerHTML = "";

        const paymentElement = checkout.createPaymentElement({
            layout: stripePaymentElementLayout()
        });

        paymentElement.mount(checkoutElements.stripeMount);

        const loadActionsResult = await checkout.loadActions();
        const checkoutActions = loadActionsResult?.actions || loadActionsResult;
        if (!checkoutActions?.confirm) {
            throw new Error("Impossible d'initialiser les actions Stripe.");
        }

        stripeCheckoutState = {
            checkout,
            paymentElement,
            actions: checkoutActions,
            orderNumber: remoteSession.orderNumber,
            invoiceNumber: remoteSession.invoiceNumber,
            stripeSessionId: remoteSession.stripeSessionId,
            signature: checkoutSignature(items, customer),
            canConfirm: true
        };

        if (typeof checkout.on === "function") {
            checkout.on("change", (session) => {
                stripeCheckoutState.canConfirm = session?.canConfirm !== false;
                syncCheckoutPaymentUi();
            });
        }

        stripeMountingSignature = "";
        checkoutElements.stripeNote.textContent = "";
        syncCheckoutPaymentUi();
    }

    async function maybeAutoInitializeStripe() {
        if (!checkoutElements || getSelectedPaymentMethodId() !== "stripe") {
            return;
        }

        const stripeConfig = await ensureStripeClientConfig().catch(() => null);
        if (clean(stripeConfig?.checkoutMode).toLowerCase() === "redirect") {
            stripeMountingSignature = "";
            checkoutElements.stripeMount.innerHTML = "";
            checkoutElements.stripeNote.textContent = "";
            syncCheckoutPaymentUi();
            return;
        }

        const items = loadCart();
        const customer = collectCheckoutCustomer();
        const shippingOptionId = getSelectedShippingOptionId();
        const selectedServicePoint = getSelectedServicePoint(shippingOptionId);
        const promoCode = normalizePromoCode(checkoutElements?.promoInput?.value);
        if (!items.length || !hasCompleteCheckoutCustomer(customer) || !shippingOptionId || !isShippingSelectionComplete()) {
            checkoutElements.stripeNote.textContent = "";
            return;
        }

        const signature = checkoutSignature(items, customer);
        if (stripeCheckoutState?.signature === signature || stripeMountingSignature === signature) {
            return;
        }

        stripeMountingSignature = signature;
        checkoutElements.feedback.textContent = stripeCheckoutState?.signature
            ? ""
            : "Chargement des moyens de paiement Stripe...";
        syncCheckoutPaymentUi();

        try {
            const remoteSession = await createStripeBackendSession(items, customer, shippingOptionId, selectedServicePoint, promoCode);
            const pendingSession = {
                orderNumber: remoteSession.orderNumber,
                invoiceNumber: remoteSession.invoiceNumber,
                stripeSessionId: remoteSession.stripeSessionId,
                customer
            };

            currentOrder = pendingSession;
            saveLastOrder(pendingSession);
            savePendingStripeSession(pendingSession);
            await mountStripePaymentElement(remoteSession, items, customer);
            checkoutElements.feedback.textContent = "";
        } catch (error) {
            stripeMountingSignature = "";
            checkoutElements.feedback.textContent = error.message || "Impossible de charger Stripe.";
            syncCheckoutPaymentUi();
        }
    }

    async function waitForStripePaymentCompletion(sessionId, orderNumber) {
        for (let index = 0; index < 8; index += 1) {
            const response = await fetch(`${shopConfig.backend.baseUrl}/api/checkout/stripe/session/${encodeURIComponent(sessionId)}`);
            const payload = await response.json().catch(() => ({}));
            if (response.ok && payload.paymentStatus === "paid") {
                clearPendingStripeSession();
                saveCart([]);
                renderCart();
                closeCart();
                closeCheckout();
                resetStripeCheckoutState();
                showCheckoutReturnBanner("success", `Commande ${payload.orderNumber || orderNumber} confirm\u00e9e via Stripe.`);
                return;
            }

            await new Promise((resolve) => window.setTimeout(resolve, 1200));
        }

        checkoutElements.feedback.textContent = "Paiement valid\u00e9. La confirmation finale Stripe est encore en cours, rechargez la page dans quelques secondes si besoin.";
    }

    function getAvailablePaymentMethods() {
        return Object.values(shopConfig.paymentMethods).filter((method) => method.enabled);
    }

    function isPaymentMethodReady(method) {
        if (method.id === "paypal" || method.id === "stripe") {
            return Boolean(shopConfig.backend.baseUrl);
        }

        return Boolean(method.checkoutUrl);
    }

    function addToCart(product) {
        const items = loadCart();
        if (!items.some((item) => item.id === product.id)) {
            items.push(product);
            saveCart(items);
        }
        renderCart();
        openCart();
    }

    function renderCart() {
        const items = loadCart();
        const count = items.length;
        const total = items.reduce((sum, item) => sum + parsePrice(item.price), 0);

        document.querySelectorAll("[data-cart-count]").forEach((counter) => {
            counter.textContent = count;
            counter.hidden = count === 0;
        });

        cartElements.total.textContent = formatPrice(total);

        if (!items.length) {
            cartElements.items.innerHTML = `<p class="cart-empty">Votre panier est vide.</p>`;
        } else {
            cartElements.items.innerHTML = items.map((item) => `
                <article class="cart-item">
                    ${item.image ? `<img src="${escapeAttribute(item.image)}" alt="">` : `<div class="cart-item__placeholder"></div>`}
                    <div>
                        <h3>${escapeHtml(item.name)}</h3>
                        ${item.category ? `<p>${escapeHtml(item.category)}</p>` : ""}
                        ${item.size ? `<p class="cart-item__size">Taille : ${escapeHtml(item.size)}</p>` : ""}
                        <strong>${escapeHtml(displayPrice(item.price))}</strong>
                    </div>
                    <button type="button" data-remove-cart-item="${escapeAttribute(item.id)}" aria-label="Retirer ${escapeAttribute(item.name)}">&times;</button>
                </article>
            `).join("");
        }

        cartElements.clearButton.disabled = count === 0;
        cartElements.checkoutButton.disabled = count === 0;
    }

    function renderCheckoutSummary(items) {
        const subtotal = items.reduce((sum, item) => sum + parsePrice(item.price), 0);
        const promotionDiscount = Number(checkoutPromotionState.promotion?.discountAmount || 0);
        const shippingOption = getSelectedShippingOption();
        const shippingAmount = shippingOption ? Number(shippingOption.shippingAmount || 0) : 0;
        const total = Math.max(subtotal - promotionDiscount, 0) + shippingAmount;
        checkoutElements.items.innerHTML = items.map((item) => `
            <article class="checkout-summary__item">
                <div>
                    <strong>${escapeHtml(item.name)}</strong>
                    ${item.category ? `<small>${escapeHtml(item.category)}</small>` : ""}
                    ${item.size ? `<small>Taille : ${escapeHtml(item.size)}</small>` : ""}
                </div>
                <span>${escapeHtml(displayPrice(item.price))}</span>
            </article>
        `).join("");
        if (checkoutElements.subtotal) {
            checkoutElements.subtotal.textContent = formatPrice(subtotal);
        }
        if (checkoutElements.promoLine && checkoutElements.promoTotal) {
            const label = checkoutElements.promoLine.querySelector("span");
            const hasPromotion = promotionDiscount > 0;
            checkoutElements.promoLine.hidden = !hasPromotion;
            if (hasPromotion) {
                if (label) {
                    label.textContent = checkoutPromotionState.promotion?.code
                        ? `Code promo (${checkoutPromotionState.promotion.code})`
                        : "Code promo";
                }
                checkoutElements.promoTotal.textContent = `-${formatPrice(promotionDiscount)}`;
            }
        }
        if (checkoutElements.shippingTotal) {
            checkoutElements.shippingTotal.textContent = shippingOption
                ? (shippingAmount <= 0 ? "Offerte" : formatPrice(shippingAmount))
                : "A calculer";
        }
        checkoutElements.total.textContent = formatPrice(total);
    }

    function renderPromotionFeedback() {
        if (!checkoutElements?.promoFeedback || !checkoutElements?.promoApplyButton) {
            return;
        }

        checkoutElements.promoApplyButton.disabled = checkoutPromotionState.loading;
        if (checkoutPromotionState.loading) {
            checkoutElements.promoFeedback.textContent = "Validation du code promo...";
            return;
        }

        if (checkoutPromotionState.error) {
            checkoutElements.promoFeedback.textContent = checkoutPromotionState.error;
            return;
        }

        if (checkoutPromotionState.promotion?.code) {
            checkoutElements.promoFeedback.textContent = `${checkoutPromotionState.promotion.code} appliqué : -${checkoutPromotionState.promotion.percentOff}%`;
            return;
        }

        checkoutElements.promoFeedback.textContent = "";
    }

    function getInvalidPricedItems(items) {
        return items.filter((item) => parsePrice(item.price) <= 0);
    }

    function openCart() {
        document.body.classList.add("cart-is-open");
    }

    function closeCart() {
        document.body.classList.remove("cart-is-open");
    }

    function openCheckout() {
        const items = loadCart();
        if (!items.length) return;

        currentOrder = null;
        resetStripeCheckoutState();
        resetCheckoutShippingState();
        resetCheckoutPromotionState();
        checkoutElements.feedback.textContent = "";
        checkoutElements.success.hidden = true;
        checkoutElements.form.hidden = false;
        checkoutElements.payNow.href = "#";
        checkoutElements.payNow.setAttribute("aria-disabled", "true");
        renderCheckoutSummary(items);
        updateCheckoutShippingOptions();
        syncCheckoutPaymentUi();
        document.body.classList.add("checkout-is-open");
        queueStripeAutofillRefresh();
    }

    function closeCheckout() {
        document.body.classList.remove("checkout-is-open");
    }

    async function handleCheckoutSubmit(event) {
        event.preventDefault();
        const items = loadCart();
        if (!items.length) {
            checkoutElements.feedback.textContent = "Ajoutez au moins un article au panier.";
            return;
        }

        const formData = new FormData(checkoutElements.form);
        const paymentMethod = getAvailablePaymentMethods().find((method) => method.id === formData.get("paymentMethod"));
        if (!paymentMethod) {
            checkoutElements.feedback.textContent = "Choisissez un mode de paiement.";
            return;
        }

        const invalidPricedItems = getInvalidPricedItems(items);
        if (invalidPricedItems.length) {
            const firstInvalid = invalidPricedItems[0];
            checkoutElements.feedback.textContent = `Prix indisponible pour ${firstInvalid.name || "un article"}. Retire cet article du panier puis recharge la page avant de r\u00e9essayer.`;
            return;
        }

        const customer = {
            firstName: clean(formData.get("firstName")),
            lastName: clean(formData.get("lastName")),
            email: clean(formData.get("email")),
            phone: clean(formData.get("phone")),
            addressLine1: clean(formData.get("addressLine1")),
            postalCode: clean(formData.get("postalCode")),
            city: clean(formData.get("city")),
            country: clean(formData.get("country")).toUpperCase() || "FR",
            customerNote: clean(formData.get("customerNote"))
        };
        const promoCode = normalizePromoCode(formData.get("promoCode"));
        const appliedPromoCode = normalizePromoCode(checkoutPromotionState.promotion?.code || checkoutPromotionState.code);

        if (promoCode && appliedPromoCode !== promoCode) {
            await applyPromotionCode();
            if (normalizePromoCode(checkoutPromotionState.promotion?.code || checkoutPromotionState.code) !== promoCode) {
                checkoutElements.feedback.textContent = checkoutPromotionState.error || "Code promo erroné.";
                return;
            }
        }

        if (!customer.firstName || !customer.lastName || !customer.email || !customer.phone || !customer.addressLine1 || !customer.postalCode || !customer.city) {
            checkoutElements.feedback.textContent = "Merci de compl\u00e9ter toutes les informations client.";
            return;
        }

        const selectedShippingOptionId = getSelectedShippingOptionId();
        if (checkoutShippingState.loading) {
            checkoutElements.feedback.textContent = "Patiente un instant, les modes de livraison sont en cours de mise a jour.";
            return;
        }
        if (!selectedShippingOptionId) {
            checkoutElements.feedback.textContent = "Choisissez un mode de livraison.";
            return;
        }
        if (!isShippingSelectionComplete()) {
            checkoutElements.feedback.textContent = checkoutReadinessMessage() || "Choisissez un point relais.";
            return;
        }

        const selectedServicePoint = getSelectedServicePoint(selectedShippingOptionId);

        if (paymentMethod.id === "paypal" && shopConfig.backend.baseUrl) {
            const submitButton = checkoutElements.form.querySelector("[type='submit']");
            checkoutElements.feedback.textContent = "Cr\u00e9ation de la commande PayPal...";
            submitButton.disabled = true;

            try {
                const remoteOrder = await createPayPalBackendOrder(items, customer, selectedShippingOptionId, selectedServicePoint, promoCode);
                const pendingOrder = {
                    orderNumber: remoteOrder.orderNumber,
                    invoiceNumber: remoteOrder.invoiceNumber,
                    paypalOrderId: remoteOrder.paypalOrderId,
                    customer
                };

                currentOrder = pendingOrder;
                saveLastOrder(pendingOrder);
                savePendingPayPalOrder(pendingOrder);
                window.location.href = remoteOrder.approvalUrl;
                return;
            } catch (error) {
                checkoutElements.feedback.textContent = error.message || "La cr\u00e9ation du paiement PayPal a \u00e9chou\u00e9.";
            } finally {
                submitButton.disabled = false;
            }

            return;
        }

        if (paymentMethod.id === "stripe" && shopConfig.backend.baseUrl) {
            const submitButton = checkoutElements.form.querySelector("[type='submit']");
            const signature = checkoutSignature(items, customer);
            submitButton.disabled = true;

            try {
                const stripeConfig = await ensureStripeClientConfig();
                if (clean(stripeConfig?.checkoutMode).toLowerCase() === "redirect") {
                    checkoutElements.feedback.textContent = "Redirection vers la page securisee Stripe...";
                    const remoteSession = await createStripeBackendSession(items, customer, selectedShippingOptionId, selectedServicePoint, promoCode);
                    const pendingSession = {
                        orderNumber: remoteSession.orderNumber,
                        invoiceNumber: remoteSession.invoiceNumber,
                        stripeSessionId: remoteSession.stripeSessionId,
                        customer
                    };

                    currentOrder = pendingSession;
                    saveLastOrder(pendingSession);
                    savePendingStripeSession(pendingSession);
                    window.location.href = remoteSession.checkoutUrl;
                    return;
                }

                if (!stripeCheckoutState || stripeCheckoutState.signature !== signature) {
                    stripeMountingSignature = signature;
                    checkoutElements.feedback.textContent = stripeCheckoutState
                        ? ""
                        : "Pr\u00e9paration du paiement Stripe...";
                    syncCheckoutPaymentUi();

                    const remoteSession = await createStripeBackendSession(items, customer, selectedShippingOptionId, selectedServicePoint, promoCode);
                    const pendingSession = {
                        orderNumber: remoteSession.orderNumber,
                        invoiceNumber: remoteSession.invoiceNumber,
                        stripeSessionId: remoteSession.stripeSessionId,
                        customer
                    };

                    currentOrder = pendingSession;
                    saveLastOrder(pendingSession);
                    savePendingStripeSession(pendingSession);
                    await mountStripePaymentElement(remoteSession, items, customer);
                    checkoutElements.feedback.textContent = "Le module Stripe est pr\u00eat. Choisissez votre moyen de paiement puis confirmez.";
                    return;
                }

                checkoutElements.feedback.textContent = "Confirmation du paiement Stripe...";
                const result = await stripeCheckoutState.actions.confirm({
                    redirect: "if_required"
                });
                if (result?.type === "error" || result?.error?.message) {
                    throw new Error(result?.error?.message || "La confirmation Stripe a \u00e9chou\u00e9.");
                }

                await waitForStripePaymentCompletion(stripeCheckoutState.stripeSessionId, stripeCheckoutState.orderNumber);
                return;
            } catch (error) {
                checkoutElements.feedback.textContent = error.message || "La cr\u00e9ation du paiement Stripe a \u00e9chou\u00e9.";
            } finally {
                syncCheckoutPaymentUi();
            }

            return;
        }


        checkoutElements.feedback.textContent = "Pr\u00e9paration de la commande et des emails...";

        const order = createOrder(items, customer, paymentMethod);
        currentOrder = order;
        saveLastOrder(order);

        let emailResult = { automated: false };
        try {
            emailResult = await sendOrderEmails(order);
        } catch (error) {
            emailResult = { automated: false, error: true };
        }

        checkoutElements.form.hidden = true;
        checkoutElements.success.hidden = false;
        checkoutElements.feedback.textContent = "";
        checkoutElements.successText.textContent = emailResult.automated
            ? "Les emails client/vendeur ont \u00e9t\u00e9 envoy\u00e9s automatiquement et la facture a \u00e9t\u00e9 g\u00e9n\u00e9r\u00e9e."
            : emailResult.error
                ? "La facture a \u00e9t\u00e9 g\u00e9n\u00e9r\u00e9e, mais l'envoi automatique des emails a \u00e9chou\u00e9. V\u00e9rifiez la configuration EmailJS."
                : "La facture a \u00e9t\u00e9 g\u00e9n\u00e9r\u00e9e. Pour l'envoi automatique des emails client/vendeur, renseignez EmailJS dans assets/js/checkout-config.js.";

        checkoutElements.successMeta.innerHTML = `
            <div><span>Commande</span><strong>${escapeHtml(order.orderNumber)}</strong></div>
            <div><span>Facture</span><strong>${escapeHtml(order.invoiceNumber)}</strong></div>
            <div><span>Total</span><strong>${escapeHtml(formatPrice(order.totalAmount))}</strong></div>
            <div><span>Paiement</span><strong>${escapeHtml(order.paymentMethod.label)}</strong></div>
        `;

        const paymentUrl = buildPaymentUrl(order);
        if (paymentUrl) {
            checkoutElements.payNow.href = paymentUrl;
            checkoutElements.payNow.setAttribute("aria-disabled", "false");
        } else {
            checkoutElements.payNow.href = "#";
            checkoutElements.payNow.setAttribute("aria-disabled", "true");
        }

        saveCart([]);
        renderCart();
        closeCart();
    }

    async function createPayPalBackendOrder(items, customer, shippingOptionId, servicePoint, promoCode = "") {
        const response = await fetch(`${shopConfig.backend.baseUrl}/api/checkout/paypal/order`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                cart: items.map((item) => ({
                    id: item.id,
                    quantity: 1,
                    name: item.name,
                    category: item.category,
                    image: item.image,
                    size: item.size,
                    price: item.price,
                    unitAmount: parsePrice(item.price)
                })),
                customer,
                promoCode,
                shipping: {
                    optionId: shippingOptionId,
                    servicePoint
                }
            })
        });

        const payload = await response.json().catch(() => ({}));
        if (!response.ok || !payload.approvalUrl || !payload.paypalOrderId) {
            throw new Error(payload?.error?.message || "Impossible de lancer PayPal.");
        }

        return payload;
    }

    async function createStripeBackendSession(items, customer, shippingOptionId, servicePoint, promoCode = "") {
        const response = await fetch(`${shopConfig.backend.baseUrl}/api/checkout/stripe/session`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                cart: items.map((item) => ({
                    id: item.id,
                    quantity: 1,
                    name: item.name,
                    category: item.category,
                    image: item.image,
                    size: item.size,
                    price: item.price,
                    unitAmount: parsePrice(item.price)
                })),
                customer,
                promoCode,
                shipping: {
                    optionId: shippingOptionId,
                    servicePoint
                }
            })
        });

        const payload = await response.json().catch(() => ({}));
        const isRedirectMode = clean(payload?.checkoutMode).toLowerCase() === "redirect";
        const hasExpectedSessionData = isRedirectMode
            ? Boolean(payload.checkoutUrl && payload.stripeSessionId)
            : Boolean(payload.clientSecret && payload.stripeSessionId);

        if (!response.ok || !hasExpectedSessionData) {
            const details = payload?.error?.details;
            const stripeMessage = typeof details?.error?.message === "string" ? details.error.message : "";
            throw new Error(stripeMessage || payload?.error?.message || "Impossible de lancer Stripe.");
        }

        return payload;
    }

    function savePendingPayPalOrder(order) {
        localStorage.setItem(PAYPAL_PENDING_STORAGE_KEY, JSON.stringify(order));
    }

    function loadPendingPayPalOrder() {
        try {
            const saved = localStorage.getItem(PAYPAL_PENDING_STORAGE_KEY);
            return saved ? JSON.parse(saved) : null;
        } catch (error) {
            return null;
        }
    }

    function clearPendingPayPalOrder() {
        localStorage.removeItem(PAYPAL_PENDING_STORAGE_KEY);
    }

    function savePendingStripeSession(session) {
        localStorage.setItem(STRIPE_PENDING_STORAGE_KEY, JSON.stringify(session));
    }

    function loadPendingStripeSession() {
        try {
            const saved = localStorage.getItem(STRIPE_PENDING_STORAGE_KEY);
            return saved ? JSON.parse(saved) : null;
        } catch (error) {
            return null;
        }
    }

    function clearPendingStripeSession() {
        localStorage.removeItem(STRIPE_PENDING_STORAGE_KEY);
    }

    function createOrder(items, customer, paymentMethod) {
        const now = new Date();
        const stamp = now.toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
        const orderNumber = `CMD-${stamp}`;
        const invoiceNumber = `${shopConfig.documents.invoicePrefix}-${stamp}`;
        const normalizedItems = items.map((item) => ({
            ...item,
            unitAmount: parsePrice(item.price)
        }));
        const totalAmount = normalizedItems.reduce((sum, item) => sum + item.unitAmount, 0);

        return {
            createdAt: now.toISOString(),
            createdAtLabel: now.toLocaleString("fr-FR"),
            orderNumber,
            invoiceNumber,
            seller: shopConfig.seller,
            customer,
            items: normalizedItems,
            totalAmount,
            paymentMethod
        };
    }

    function buildPaymentUrl(order) {
        const method = order.paymentMethod;
        if (!method.checkoutUrl) return "";

        if (method.id === "paypal" && /paypal\.me/i.test(method.checkoutUrl)) {
            const baseUrl = method.checkoutUrl.replace(/\/+$/, "");
            return `${baseUrl}/${order.totalAmount.toFixed(2)}EUR`;
        }

        return appendPaymentMetadata(method.checkoutUrl, order);
    }

    function appendPaymentMetadata(url, order) {
        try {
            const paymentUrl = new URL(url);
            paymentUrl.searchParams.set("order_number", order.orderNumber);
            paymentUrl.searchParams.set("invoice_number", order.invoiceNumber);
            paymentUrl.searchParams.set("amount", order.totalAmount.toFixed(2));
            paymentUrl.searchParams.set("currency", "EUR");
            paymentUrl.searchParams.set("customer_email", order.customer.email);
            paymentUrl.searchParams.set("customer_name", `${order.customer.firstName} ${order.customer.lastName}`.trim());
            return paymentUrl.toString();
        } catch (error) {
            return url;
        }
    }

    function hasAutomatedEmailDelivery() {
        return shopConfig.emailDelivery.provider === "emailjs"
            && shopConfig.emailDelivery.publicKey
            && shopConfig.emailDelivery.serviceId
            && shopConfig.emailDelivery.templates.clientSummary
            && shopConfig.emailDelivery.templates.clientInvoice
            && shopConfig.emailDelivery.templates.sellerInvoice;
    }

    async function sendOrderEmails(order) {
        if (!hasAutomatedEmailDelivery()) {
            return { automated: false };
        }

        const invoiceHtml = buildInvoiceDocument(order);
        const summaryText = buildClientSummaryText(order);
        const invoiceText = buildClientInvoiceText(order);
        const sellerText = buildSellerInvoiceText(order);

        await Promise.all([
            sendEmailViaEmailJs(shopConfig.emailDelivery.templates.clientSummary, {
                to_email: order.customer.email,
                to_name: `${order.customer.firstName} ${order.customer.lastName}`.trim(),
                subject: `${order.orderNumber} - Récapitulatif de commande`,
                message: summaryText,
                order_number: order.orderNumber,
                invoice_number: order.invoiceNumber,
                payment_method: order.paymentMethod.label,
                total_amount: formatPrice(order.totalAmount),
                invoice_html: invoiceHtml
            }),
            sendEmailViaEmailJs(shopConfig.emailDelivery.templates.clientInvoice, {
                to_email: order.customer.email,
                to_name: `${order.customer.firstName} ${order.customer.lastName}`.trim(),
                subject: `${order.invoiceNumber} - Votre facture`,
                message: invoiceText,
                order_number: order.orderNumber,
                invoice_number: order.invoiceNumber,
                total_amount: formatPrice(order.totalAmount),
                invoice_html: invoiceHtml
            }),
            sendEmailViaEmailJs(shopConfig.emailDelivery.templates.sellerInvoice, {
                to_email: order.seller.email,
                to_name: order.seller.brandName,
                subject: `${order.invoiceNumber} - Facture vendeur`,
                message: sellerText,
                order_number: order.orderNumber,
                invoice_number: order.invoiceNumber,
                total_amount: formatPrice(order.totalAmount),
                payment_method: order.paymentMethod.label,
                invoice_html: invoiceHtml
            })
        ]);

        return { automated: true };
    }

    async function sendSingleEmail(kind, order) {
        if (!order) return;
        if (!hasAutomatedEmailDelivery()) {
            checkoutElements.successText.textContent = "EmailJS n'est pas encore configuré. Les boutons de renvoi nécessitent les identifiants dans assets/js/checkout-config.js.";
            return;
        }

        const invoiceHtml = buildInvoiceDocument(order);

        try {
            if (kind === "clientSummary") {
                await sendEmailViaEmailJs(shopConfig.emailDelivery.templates.clientSummary, {
                    to_email: order.customer.email,
                    to_name: `${order.customer.firstName} ${order.customer.lastName}`.trim(),
                    subject: `${order.orderNumber} - Récapitulatif de commande`,
                    message: buildClientSummaryText(order),
                    order_number: order.orderNumber,
                    invoice_number: order.invoiceNumber,
                    total_amount: formatPrice(order.totalAmount),
                    payment_method: order.paymentMethod.label,
                    invoice_html: invoiceHtml
                });
                checkoutElements.successText.textContent = "Récapitulatif client renvoyé.";
                return;
            }

            if (kind === "clientInvoice") {
                await sendEmailViaEmailJs(shopConfig.emailDelivery.templates.clientInvoice, {
                    to_email: order.customer.email,
                    to_name: `${order.customer.firstName} ${order.customer.lastName}`.trim(),
                    subject: `${order.invoiceNumber} - Votre facture`,
                    message: buildClientInvoiceText(order),
                    order_number: order.orderNumber,
                    invoice_number: order.invoiceNumber,
                    total_amount: formatPrice(order.totalAmount),
                    invoice_html: invoiceHtml
                });
                checkoutElements.successText.textContent = "Facture client renvoyée.";
                return;
            }

            if (kind === "sellerInvoice") {
                await sendEmailViaEmailJs(shopConfig.emailDelivery.templates.sellerInvoice, {
                    to_email: order.seller.email,
                    to_name: order.seller.brandName,
                    subject: `${order.invoiceNumber} - Facture vendeur`,
                    message: buildSellerInvoiceText(order),
                    order_number: order.orderNumber,
                    invoice_number: order.invoiceNumber,
                    total_amount: formatPrice(order.totalAmount),
                    payment_method: order.paymentMethod.label,
                    invoice_html: invoiceHtml
                });
                checkoutElements.successText.textContent = "Facture vendeur renvoyée.";
            }
        } catch (error) {
            checkoutElements.successText.textContent = "Le renvoi de l'email a échoué. Vérifiez la configuration EmailJS.";
        }
    }

    async function sendEmailViaEmailJs(templateId, templateParams) {
        const response = await fetch("https://api.emailjs.com/api/v1.0/email/send", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                service_id: shopConfig.emailDelivery.serviceId,
                template_id: templateId,
                user_id: shopConfig.emailDelivery.publicKey,
                template_params: templateParams
            })
        });

        if (!response.ok) {
            throw new Error("Envoi EmailJS impossible");
        }
    }

    function buildClientSummaryText(order) {
        const lines = [
            `Bonjour ${order.customer.firstName},`,
            "",
            `Merci pour votre commande chez ${order.seller.brandName}.`,
            `Référence commande : ${order.orderNumber}`,
            `Mode de paiement choisi : ${order.paymentMethod.label}`,
            "",
            "Articles :"
        ];

        order.items.forEach((item) => {
            lines.push(`- ${item.name}${item.size ? ` (taille ${item.size})` : ""} : ${formatPrice(item.unitAmount)}`);
        });

        lines.push("");
        lines.push(`Total : ${formatPrice(order.totalAmount)}`);
        lines.push("");
        lines.push("Votre facture est envoyée séparément.");
        return lines.join("\n");
    }

    function buildClientInvoiceText(order) {
        return [
            `Bonjour ${order.customer.firstName},`,
            "",
            `Veuillez trouver votre facture ${order.invoiceNumber} pour la commande ${order.orderNumber}.`,
            `Montant total : ${formatPrice(order.totalAmount)}`,
            `Paiement : ${order.paymentMethod.label}`,
            "",
            "Le détail de la facture est inclus dans le template email."
        ].join("\n");
    }

    function buildSellerInvoiceText(order) {
        const lines = [
            `Bonjour,`,
            "",
            `Nouvelle commande : ${order.orderNumber}`,
            `Facture : ${order.invoiceNumber}`,
            `Date : ${order.createdAtLabel}`,
            `Paiement : ${order.paymentMethod.label}`,
            "",
            `Client : ${order.customer.firstName} ${order.customer.lastName}`,
            `Email : ${order.customer.email}`,
            `Téléphone : ${order.customer.phone}`,
            `Adresse : ${order.customer.addressLine1}, ${order.customer.postalCode} ${order.customer.city}`,
            "",
            "Articles :"
        ];

        order.items.forEach((item) => {
            lines.push(`- ${item.name}${item.size ? ` - taille ${item.size}` : ""} (${item.category || "collection"}) : ${formatPrice(item.unitAmount)}`);
        });

        lines.push("");
        lines.push(`Total : ${formatPrice(order.totalAmount)}`);
        return lines.join("\n");
    }

    function buildDocumentShell(title, bodyMarkup) {
        return `<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${escapeHtml(title)}</title>
    <style>
        body { margin: 0; background: #f7f3eb; color: #1b1711; font-family: Georgia, "Times New Roman", serif; }
        .document { max-width: 960px; margin: 0 auto; padding: 48px 28px 60px; background: #fffdf8; }
        .document__header, .document__meta, .document__footer { display: flex; justify-content: space-between; gap: 24px; }
        .document__header { padding-bottom: 24px; border-bottom: 2px solid #d7bd8b; }
        .document h1, .document h2, .document h3 { margin: 0 0 12px; font-family: "Times New Roman", Georgia, serif; letter-spacing: 0.04em; text-transform: uppercase; }
        .document p, .document td, .document th { font-size: 15px; line-height: 1.5; }
        .document__meta, .document__sections { margin-top: 28px; }
        .document__box { flex: 1; padding: 18px; border: 1px solid #e3d4b7; background: #fff; }
        table { width: 100%; border-collapse: collapse; margin-top: 22px; }
        th, td { padding: 12px 10px; border-bottom: 1px solid #eadfcb; text-align: left; }
        th:last-child, td:last-child { text-align: right; }
        .document__totals { width: min(360px, 100%); margin-left: auto; margin-top: 18px; }
        .document__totals div { display: flex; justify-content: space-between; padding: 8px 0; }
        .document__totals strong { font-size: 18px; }
        .document__footer { margin-top: 40px; padding-top: 22px; border-top: 1px solid #e3d4b7; color: #6f5f43; font-size: 13px; }
    </style>
</head>
<body>
    ${bodyMarkup}
</body>
</html>`;
    }

    function buildInvoiceDocument(order) {
        const itemsMarkup = order.items.map((item) => `
            <tr>
                <td>${escapeHtml(item.name)}${item.size ? `<br><small>Taille : ${escapeHtml(item.size)}</small>` : ""}</td>
                <td>1</td>
                <td>${escapeHtml(formatPrice(item.unitAmount))}</td>
                <td>${escapeHtml(formatPrice(item.unitAmount))}</td>
            </tr>
        `).join("");

        return buildDocumentShell(
            `${order.invoiceNumber} - Facture`,
            `
            <main class="document">
                <header class="document__header">
                    <div>
                        <h1>Facture</h1>
                        <p><strong>${escapeHtml(order.seller.brandName)}</strong></p>
                        <p>${escapeHtml(order.seller.addressLine1)}</p>
                        <p>${escapeHtml(`${order.seller.postalCode} ${order.seller.city}`.trim())}</p>
                        <p>${escapeHtml(order.seller.country)}</p>
                    </div>
                    <div>
                        <p><strong>Facture n°</strong> ${escapeHtml(order.invoiceNumber)}</p>
                        <p><strong>Commande</strong> ${escapeHtml(order.orderNumber)}</p>
                        <p><strong>Date</strong> ${escapeHtml(order.createdAtLabel)}</p>
                    </div>
                </header>
                <section class="document__meta">
                    <div class="document__box">
                        <h2>Facturé à</h2>
                        <p>${escapeHtml(`${order.customer.firstName} ${order.customer.lastName}`)}</p>
                        <p>${escapeHtml(order.customer.addressLine1)}</p>
                        <p>${escapeHtml(`${order.customer.postalCode} ${order.customer.city}`)}</p>
                        <p>${escapeHtml(order.customer.email)}</p>
                    </div>
                    <div class="document__box">
                        <h2>Informations vendeur</h2>
                        <p>Email : ${escapeHtml(order.seller.email)}</p>
                        <p>Téléphone : ${escapeHtml(order.seller.phone)}</p>
                        ${order.seller.siret ? `<p>SIRET : ${escapeHtml(order.seller.siret)}</p>` : ""}
                        ${order.seller.vatNumber ? `<p>TVA : ${escapeHtml(order.seller.vatNumber)}</p>` : ""}
                    </div>
                </section>
                <section class="document__sections">
                    <table>
                        <thead>
                            <tr>
                                <th>Désignation</th>
                                <th>Qté</th>
                                <th>Prix unitaire</th>
                                <th>Total</th>
                            </tr>
                        </thead>
                        <tbody>${itemsMarkup}</tbody>
                    </table>
                    <div class="document__totals">
                        <div><span>Sous-total</span><span>${escapeHtml(formatPrice(order.totalAmount))}</span></div>
                        <div><span>Total</span><strong>${escapeHtml(formatPrice(order.totalAmount))}</strong></div>
                    </div>
                </section>
                <footer class="document__footer">
                    <p>Méthode de paiement sélectionnée : ${escapeHtml(order.paymentMethod.label)}</p>
                    <p>Facture générée automatiquement depuis le panier du site.</p>
                </footer>
            </main>
            `
        );
    }

    function downloadDocument(filename, content) {
        const blob = new Blob([content], { type: "text/html;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
    }

    function showCheckoutReturnBanner(type, message) {
        const existing = document.querySelector("[data-checkout-return-banner]");
        if (existing) existing.remove();

        const banner = document.createElement("div");
        banner.dataset.checkoutReturnBanner = "true";
        banner.style.position = "fixed";
        banner.style.left = "16px";
        banner.style.right = "16px";
        banner.style.bottom = "16px";
        banner.style.zIndex = "9999";
        banner.style.padding = "16px 18px";
        banner.style.borderRadius = "16px";
        banner.style.boxShadow = "0 18px 40px rgba(0,0,0,0.18)";
        banner.style.background = type === "success" ? "#173f35" : "#6c1f1f";
        banner.style.color = "#fff";
        banner.style.fontSize = "15px";
        banner.style.lineHeight = "1.5";
        banner.style.opacity = "1";
        banner.style.transition = "opacity 260ms ease, transform 260ms ease";
        banner.innerHTML = `
            <strong style="display:block;margin-bottom:4px;">${type === "success" ? "Paiement confirm\u00e9" : "Paiement annul\u00e9"}</strong>
            <span>${escapeHtml(message)}</span>
        `;

        document.body.appendChild(banner);

        window.setTimeout(() => {
            banner.style.opacity = "0";
            banner.style.transform = "translateY(10px)";

            window.setTimeout(() => {
                banner.remove();
            }, 260);
        }, 4500);
    }

    async function handlePaymentReturn() {
        const url = new URL(window.location.href);
        const payment = clean(url.searchParams.get("payment"));
        const provider = clean(url.searchParams.get("provider"));
        if (!payment) return;

        const orderNumber = clean(url.searchParams.get("order"));
        const paypalOrderId = clean(url.searchParams.get("token"));
        const pendingOrder = provider === "stripe" ? loadPendingStripeSession() : loadPendingPayPalOrder();

        if (payment === "cancel") {
            showCheckoutReturnBanner("error", `Le paiement ${provider === "stripe" ? "Stripe" : "PayPal"} a \u00e9t\u00e9 annul\u00e9. Ton panier est rest\u00e9 intact.`);
            cleanupPaymentUrl(url);
            return;
        }

        if (provider === "stripe") {
            await handleStripeReturn(url, pendingOrder);
            return;
        }

        if (payment !== "success" || !paypalOrderId) {
            cleanupPaymentUrl(url);
            return;
        }

        if (pendingOrder?.paypalOrderId && pendingOrder.paypalOrderId !== paypalOrderId) {
            showCheckoutReturnBanner("error", "Le paiement retourn\u00e9 ne correspond pas \u00e0 la commande en attente.");
            cleanupPaymentUrl(url);
            return;
        }

        try {
            const response = await fetch(`${shopConfig.backend.baseUrl}/api/checkout/paypal/order/${encodeURIComponent(paypalOrderId)}/capture`, {
                method: "POST"
            });
            const payload = await response.json().catch(() => ({}));

            if (!response.ok) {
                throw new Error(payload?.error?.message || "La capture du paiement a \u00e9chou\u00e9.");
            }

            clearPendingPayPalOrder();
            saveCart([]);
            renderCart();
            showCheckoutReturnBanner("success", `Commande ${payload.orderNumber || orderNumber} confirm\u00e9e.`);
        } catch (error) {
            showCheckoutReturnBanner("error", error.message || "La confirmation du paiement PayPal a \u00e9chou\u00e9.");
        } finally {
            cleanupPaymentUrl(url);
        }
    }

    async function handleStripeReturn(url, pendingSession) {
        const sessionId = clean(url.searchParams.get("session_id"));
        const orderNumber = clean(url.searchParams.get("order"));

        if (!sessionId) {
            cleanupPaymentUrl(url);
            return;
        }

        if (pendingSession?.stripeSessionId && pendingSession.stripeSessionId !== sessionId) {
            showCheckoutReturnBanner("error", "La session Stripe retourn\u00e9e ne correspond pas \u00e0 la commande en attente.");
            cleanupPaymentUrl(url);
            return;
        }

        try {
            const response = await fetch(`${shopConfig.backend.baseUrl}/api/checkout/stripe/session/${encodeURIComponent(sessionId)}`);
            const payload = await response.json().catch(() => ({}));

            if (!response.ok) {
                throw new Error(payload?.error?.message || "Impossible de verifier le paiement Stripe.");
            }

            if (payload.paymentStatus === "paid") {
                clearPendingStripeSession();
                saveCart([]);
                renderCart();
                showCheckoutReturnBanner("success", `Commande ${payload.orderNumber || orderNumber} confirm\u00e9e via Stripe.`);
            } else {
                showCheckoutReturnBanner("success", `La session Stripe ${payload.orderNumber || orderNumber} est revenue avec le statut ${payload.paymentStatus || payload.status}. Le webhook finalisera la commande dès confirmation.`);
            }
        } catch (error) {
            showCheckoutReturnBanner("error", error.message || "La vérification du paiement Stripe a échoué.");
        } finally {
            cleanupPaymentUrl(url);
        }
    }

    function cleanupPaymentUrl(url) {
        url.searchParams.delete("payment");
        url.searchParams.delete("order");
        url.searchParams.delete("provider");
        url.searchParams.delete("session_id");
        url.searchParams.delete("token");
        url.searchParams.delete("PayerID");
        window.history.replaceState({}, "", url.toString());
    }

    setupCart();
    setupCheckout();
    enableImageFallbacks();
    handlePaymentReturn();
    if (!hasProductUi) {
        return;
    }

    Promise.all([
        fetchCatalogText(),
        fetchAvailabilityOverrides()
    ])
        .then(([text, unavailableIds]) => {
            const products = applyAvailabilityOverrides(parseCsv(text), unavailableIds);
            if (!products.length) throw new Error("Aucun produit dans la source");
            catalogProducts = products;
            renderCatalog(products);
            renderSelection(products);
            renderProductDetail(products);
        })
        .catch(() => {
            catalogProducts = [];
            renderCatalog([]);
            renderSelection([]);
            renderProductDetail([]);
        })
        .finally(enableGallery);
})();

