(function () {
    const productGrid = document.querySelector("[data-products-grid]");
    const selectionGrid = document.querySelector("[data-selection-grid]");
    if (!productGrid && !selectionGrid) return;

    const CART_STORAGE_KEY = "laGoutteDeMerCart";
    const WHATSAPP_PHONE = "33766884222";
    const status = document.querySelector("[data-products-status]");
    const sourceUrl = window.PRODUCTS_SOURCE_URL ||"https://docs.google.com/spreadsheets/d/1tqC0MURptEfWWk4wJQWo8xMI-ToCadDEtjMugoOwTDQ/export?format=csv&gid=376933709";
    const cacheSafeSourceUrl = sourceUrl.includes("docs.google.com")
        ? `${sourceUrl}${sourceUrl.includes("?") ? "&" : "?"}_=${Date.now()}`
        : sourceUrl;

    const DEFAULT_IMAGE_FALLBACK = "";

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

        return rows.map((cells) => {
            const item = {};
            headers.forEach((header, index) => {
                item[header] = (cells[index] || "").trim();
            });
            return item;
        });
    }

    function isSelected(value) {
        return ["oui", "yes", "true", "1", "x", "selection", "sélection"].includes((value || "").trim().toLowerCase());
    }

    function driveImageUrl(fileId) {
        return `https://drive.google.com/thumbnail?id=${fileId}&sz=w1600`;
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

    function clean(value) {
        return String(value || "").trim();
    }

    function escapeHtml(value) {
        const div = document.createElement("div");
        div.textContent = clean(value);
        return div.innerHTML;
    }

    function escapeAttribute(value) {
        return escapeHtml(value).replace(/"/g, "&quot;");
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

    function displayPrice(value) {
        const parsed = parsePrice(value);
        return parsed > 0 ? formatPrice(parsed) : clean(value);
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

    function catalogCard(product) {
        const photos = photosOf(product);
        const mainPhoto = photos[0] || DEFAULT_IMAGE_FALLBACK;
        const fallbackPhoto = photos[1] || DEFAULT_IMAGE_FALLBACK;
        const thumbnails = photos.map((photo, index) => `
            <button class="catalog-card__thumb${index === 0 ? " is-active" : ""}" type="button" data-photo="${photo}" aria-label="Voir la photo ${index + 1}">
                <img src="${photo}" alt="" data-fallback-photo="${escapeAttribute(index === 0 ? fallbackPhoto : DEFAULT_IMAGE_FALLBACK)}">
            </button>
        `).join("");

        return `
            <article class="catalog-card">
                <div class="catalog-card__media">
                    <img class="catalog-card__image" src="${mainPhoto}" alt="" data-fallback-photo="${escapeAttribute(fallbackPhoto)}">
                </div>
                ${photos.length > 1 ? `<div class="catalog-card__thumbs">${thumbnails}</div>` : ""}
                <div class="catalog-card__content">
                    <p class="catalog-card__status">${product.statut || "disponible"}</p>
                    <h2>${product.nom}</h2>
                    <p>${product.description}</p>
                    ${priceMarkup(product, "catalog-card__price")}
                    <button
                        class="button button--small catalog-card__cart"
                        type="button"
                        data-add-to-cart
                        data-id="${escapeAttribute(product.id)}"
                        data-name="${escapeAttribute(product.nom)}"
                        data-price="${escapeAttribute(productPrice(product))}"
                        data-category="${escapeAttribute(product.categorie)}"
                        data-image="${escapeAttribute(mainPhoto)}"
                    >Ajouter au panier</button>
                </div>
            </article>
        `;
    }

    function miniCard(product) {
        const photos = photosOf(product);
        const mainPhoto = photos[0] || DEFAULT_IMAGE_FALLBACK;
        const fallbackPhoto = photos[1] || DEFAULT_IMAGE_FALLBACK;

        return `
            <article class="mini-product">
                <a href="${product.categorie}.html" aria-label="Voir l'article">
                    <img src="${mainPhoto}" alt="" data-fallback-photo="${escapeAttribute(fallbackPhoto)}">
                    <h3>${product.nom}</h3>
                    ${priceMarkup(product, "mini-product__price")}
                </a>
                <button
                    class="button button--small mini-product__cart"
                    type="button"
                    data-add-to-cart
                    data-id="${escapeAttribute(product.id)}"
                    data-name="${escapeAttribute(product.nom)}"
                    data-price="${escapeAttribute(productPrice(product))}"
                    data-category="${escapeAttribute(product.categorie)}"
                    data-image="${escapeAttribute(mainPhoto)}"
                >Ajouter au panier</button>
            </article>
        `;
    }

    function renderCatalog(products) {
        if (!productGrid) return;

        const category = productGrid.dataset.category;
        const filtered = products.filter((product) => product.categorie === category);
        if (!filtered.length) {
            productGrid.innerHTML = `<p class="catalog-empty">Aucun article disponible pour le moment.</p>`;
            if (status) status.textContent = "0 article";
            return;
        }

        productGrid.innerHTML = filtered.map(catalogCard).join("");
        if (status) status.textContent = `${filtered.length} article${filtered.length > 1 ? "s" : ""}`;
    }

    function renderSelection(products) {
        if (!selectionGrid) return;

        const hasSelectionColumn = products.some((product) => Object.prototype.hasOwnProperty.call(product, "selection_moment"));
        let selected = (hasSelectionColumn
            ? products.filter((product) => isSelected(product.selection_moment))
            : products
        ).slice(0, 6);

        if (!selected.length) {
            selected = products.slice(0, 6);
        }
        if (!selected.length) {
            selectionGrid.innerHTML = `<p class="catalog-empty">La sélection du moment arrive bientôt.</p>`;
            return;
        }

        selectionGrid.innerHTML = selected.map(miniCard).join("");
    }

    function enableGallery() {
        if (!productGrid) return;

        productGrid.addEventListener("click", (event) => {
            const thumb = event.target.closest("[data-photo]");
            if (!thumb) return;

            const card = thumb.closest(".catalog-card");
            const image = card.querySelector(".catalog-card__image");
            image.src = thumb.dataset.photo;
            card.querySelectorAll(".catalog-card__thumb").forEach((button) => button.classList.remove("is-active"));
            thumb.classList.add("is-active");
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
                <div class="cart-panel__actions">
                    <button type="button" data-cart-clear>Vider</button>
                    <a href="#" target="_blank" rel="noopener" data-cart-order>Commander</a>
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

        cartButton.addEventListener("click", openCart);
        backdrop.addEventListener("click", closeCart);
        panel.querySelector("[data-cart-close]").addEventListener("click", closeCart);
        panel.querySelector("[data-cart-clear]").addEventListener("click", () => {
            saveCart([]);
            renderCart();
        });
        panel.querySelector("[data-cart-items]").addEventListener("click", (event) => {
            const removeButton = event.target.closest("[data-remove-cart-item]");
            if (!removeButton) return;
            const items = loadCart().filter((item) => item.id !== removeButton.dataset.removeCartItem);
            saveCart(items);
            renderCart();
        });
        document.addEventListener("click", (event) => {
            const addButton = event.target.closest("[data-add-to-cart]");
            if (!addButton) return;
            addToCart({
                id: addButton.dataset.id,
                name: addButton.dataset.name,
                price: addButton.dataset.price,
                category: addButton.dataset.category,
                image: addButton.dataset.image
            });
            addButton.textContent = "Dans le panier";
            window.setTimeout(() => {
                addButton.textContent = "Ajouter au panier";
            }, 1200);
        });
        document.addEventListener("keydown", (event) => {
            if (event.key === "Escape") closeCart();
        });

        renderCart();
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
        const cartItems = document.querySelector("[data-cart-items]");
        const orderLink = document.querySelector("[data-cart-order]");
        const clearButton = document.querySelector("[data-cart-clear]");

        document.querySelectorAll("[data-cart-count]").forEach((counter) => {
            counter.textContent = count;
            counter.hidden = count === 0;
        });
        document.querySelector("[data-cart-total]").textContent = formatPrice(total);

        if (!items.length) {
            cartItems.innerHTML = `<p class="cart-empty">Votre panier est vide.</p>`;
        } else {
            cartItems.innerHTML = items.map((item) => `
                <article class="cart-item">
                    ${item.image ? `<img src="${escapeAttribute(item.image)}" alt="">` : `<div class="cart-item__placeholder"></div>`}
                    <div>
                        <h3>${escapeHtml(item.name)}</h3>
                        ${item.category ? `<p>${escapeHtml(item.category)}</p>` : ""}
                        <strong>${escapeHtml(displayPrice(item.price))}</strong>
                    </div>
                    <button type="button" data-remove-cart-item="${escapeAttribute(item.id)}" aria-label="Retirer ${escapeAttribute(item.name)}">&times;</button>
                </article>
            `).join("");
        }

        clearButton.disabled = count === 0;
        orderLink.href = count ? buildWhatsappOrder(items, total) : "#";
        orderLink.setAttribute("aria-disabled", String(count === 0));
    }

    function buildWhatsappOrder(items, total) {
        const lines = [
            "Bonjour, je souhaite commander :",
            ""
        ];

        items.forEach((item) => {
            lines.push(`- ${item.name} - ${displayPrice(item.price)}`);
        });

        lines.push("");
        lines.push(`Total : ${formatPrice(total)}`);
        return `https://wa.me/${WHATSAPP_PHONE}?text=${encodeURIComponent(lines.join("\n"))}`;
    }

    function openCart() {
        document.body.classList.add("cart-is-open");
    }

    function closeCart() {
        document.body.classList.remove("cart-is-open");
    }

    setupCart();
    enableImageFallbacks();

    fetch(cacheSafeSourceUrl)
        .then((response) => {
            if (!response.ok) throw new Error("Source produits indisponible");
            return response.text();
        })
        .then((text) => {
            const products = parseCsv(text);
            if (!products.length) throw new Error("Aucun produit dans la source");
            renderCatalog(products);
            renderSelection(products);
        })
        .catch(() => {
            renderCatalog([]);
            renderSelection([]);
        })
        .finally(enableGallery);
})();
