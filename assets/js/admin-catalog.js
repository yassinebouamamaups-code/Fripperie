(function () {
    const form = document.querySelector("[data-admin-form]");
    const status = document.querySelector("[data-admin-status]");
    const recentList = document.querySelector("[data-admin-recent]");
    const photoInput = document.querySelector("[data-admin-photo-files]");
    const uploadedPhotosInput = document.querySelector("[data-admin-uploaded-photos]");
    const photoPreview = document.querySelector("[data-admin-photo-preview]");
    const backendBadge = document.querySelector("[data-admin-backend]");
    const writableBadge = document.querySelector("[data-admin-writable]");
    const sourceBadge = document.querySelector("[data-admin-source]");
    const loginForm = document.querySelector("[data-admin-login-form]");
    const loginPanel = document.querySelector("[data-admin-login]");
    const appPanel = document.querySelector("[data-admin-app]");
    const passwordInput = document.querySelector("[data-admin-password]");
    const logoutButton = document.querySelector("[data-admin-logout]");
    const catalogUrlNode = document.querySelector("[data-admin-catalog-url]");

    if (!form || !loginForm) return;

    const backendBaseUrl = resolveBackendBaseUrl();
    const ADMIN_STORAGE_KEY = "laGoutteDeMerAdminKey";
    let uploadedPhotos = [];
    let adminKey = loadAdminKey();

    renderBackendInfo();
    bindEvents();
    if (adminKey) {
        authenticateSilently();
    } else {
        showLogin();
    }

    function bindEvents() {
        loginForm.addEventListener("submit", async (event) => {
            event.preventDefault();
            const candidate = String(passwordInput.value || "").trim();
            if (!candidate) {
                setStatus("Entrez le mot de passe admin.", "warning");
                return;
            }

            try {
                setStatus("Connexion admin en cours...", "pending");
                await verifyAdminKey(candidate);
                adminKey = candidate;
                saveAdminKey(adminKey);
                passwordInput.value = "";
                showApp();
                loadCatalogState();
                setStatus("Connexion admin validee.", "success");
            } catch (error) {
                setStatus(error.message || "Mot de passe invalide.", "error");
            }
        });

        logoutButton.addEventListener("click", () => {
            adminKey = "";
            uploadedPhotos = [];
            clearAdminKey();
            form.reset();
            renderPhotoPreview();
            showLogin();
            setStatus("Session admin fermee.", "pending");
        });

        form.addEventListener("submit", async (event) => {
            event.preventDefault();
            setStatus("Enregistrement de l'article en cours...", "pending");

            try {
                if (photoInput.files.length) {
                    await uploadSelectedPhotos();
                }

                const payload = buildPayload(new FormData(form));
                const response = await fetch(`${backendBaseUrl}/api/admin/catalog/items`, {
                    method: "POST",
                    headers: adminHeaders({
                        "Content-Type": "application/json"
                    }),
                    body: JSON.stringify(payload)
                });

                const result = await response.json().catch(() => ({}));
                if (!response.ok) {
                    throw new Error(result?.error?.message || "Impossible d'ajouter l'article.");
                }

                form.reset();
                uploadedPhotos = [];
                syncUploadedPhotosField();
                renderPhotoPreview();
                setStatus(`Article "${result.item?.nom || payload.nom}" publie.`, "success");
                loadCatalogState();
            } catch (error) {
                setStatus(error.message || "Une erreur est survenue.", "error");
            }
        });

        photoInput.addEventListener("change", () => {
            setStatus(`${photoInput.files.length || 0} photo(s) prete(s) a etre envoyee(s).`, "pending");
        });
    }

    function resolveBackendBaseUrl() {
        const configured = window.SHOP_CHECKOUT_CONFIG?.backend?.baseUrl;
        if (configured) return stripTrailingSlash(configured);

        if (window.location.hostname === "127.0.0.1" || window.location.hostname === "localhost") {
            return "http://localhost:3001";
        }

        return stripTrailingSlash(window.location.origin);
    }

    async function loadCatalogState() {
        try {
            const response = await fetch(`${backendBaseUrl}/api/admin/catalog`, {
                headers: adminHeaders()
            });
            const result = await response.json().catch(() => ({}));

            if (!response.ok) {
                throw new Error(result?.error?.message || "Impossible de charger le catalogue.");
            }

            writableBadge.textContent = result.writable ? "CSV local modifiable" : "Ecriture locale inactive";
            writableBadge.dataset.state = result.writable ? "success" : "warning";
            sourceBadge.textContent = result.sourceUrl || "Source publique non definie";
            catalogUrlNode.textContent = result.sourceUrl || "";
            renderRecentItems(result.items || []);

            if (!result.writable) {
                setStatus("Le backend est accessible, mais `CATALOG_WRITE_FILE` n'est pas configure pour l'ecriture.", "warning");
            }
        } catch (error) {
            if (/refuse|401/i.test(String(error.message || ""))) {
                adminKey = "";
                clearAdminKey();
                showLogin();
            }
            setStatus(error.message || "Impossible de joindre le backend.", "error");
        }
    }

    async function uploadSelectedPhotos() {
        const files = Array.from(photoInput.files || []);
        if (!files.length) return;

        const newUrls = [];
        for (const file of files) {
            const uploadResponse = await fetch(`${backendBaseUrl}/api/admin/catalog/upload-image`, {
                method: "POST",
                headers: adminHeaders({
                    "Content-Type": file.type || "application/octet-stream",
                    "X-File-Name": encodeURIComponent(file.name || "photo")
                }),
                body: file
            });

            const uploadResult = await uploadResponse.json().catch(() => ({}));
            if (!uploadResponse.ok) {
                throw new Error(uploadResult?.error?.message || `Impossible d'envoyer ${file.name}.`);
            }

            newUrls.push(uploadResult.relativeUrl);
        }

        uploadedPhotos = uploadedPhotos.concat(newUrls);
        syncUploadedPhotosField();
        renderPhotoPreview();
        photoInput.value = "";
    }

    function buildPayload(formData) {
        const remotePhotos = String(formData.get("remote_photos") || "")
            .split(/\n+/)
            .map((entry) => entry.trim())
            .filter(Boolean);

        return {
            id: formData.get("id"),
            categorie: formData.get("categorie"),
            nom: formData.get("nom"),
            taille: formData.get("taille"),
            prix: formData.get("prix"),
            promo: formData.get("promo"),
            selection_moment: formData.get("selection_moment"),
            description: formData.get("description"),
            statut: formData.get("statut"),
            photos: uploadedPhotos.concat(remotePhotos)
        };
    }

    function syncUploadedPhotosField() {
        uploadedPhotosInput.value = uploadedPhotos.join("\n");
    }

    function renderPhotoPreview() {
        if (!photoPreview) return;
        if (!uploadedPhotos.length) {
            photoPreview.innerHTML = '<p class="admin-helper">Les photos envoyees apparaitront ici.</p>';
            return;
        }

        photoPreview.innerHTML = uploadedPhotos.map((photo) => `
            <figure class="admin-photo-card">
                <img src="${escapeHtml(photo)}" alt="">
                <figcaption>${escapeHtml(photo)}</figcaption>
            </figure>
        `).join("");
    }

    function renderRecentItems(items) {
        if (!recentList) return;
        if (!items.length) {
            recentList.innerHTML = '<p class="admin-helper">Aucun article local dans le CSV pour le moment.</p>';
            return;
        }

        recentList.innerHTML = items.slice(0, 10).map((item) => {
            const photos = String(item.photos || "").split(/[|;]/).map((entry) => entry.trim()).filter(Boolean);
            const image = photos[0] || "";

            return `
                <article class="admin-recent-card">
                    <div class="admin-recent-card__media">
                        ${image ? `<img src="${escapeHtml(image)}" alt="">` : '<div class="admin-recent-card__placeholder">Sans photo</div>'}
                    </div>
                    <div class="admin-recent-card__body">
                        <p class="admin-recent-card__meta">${escapeHtml(item.categorie || "categorie")} • ${escapeHtml(item.statut || "disponible")}</p>
                        <h3>${escapeHtml(item.nom || "Article")}</h3>
                        <p>${escapeHtml(item.taille || "Taille libre")} • ${escapeHtml(item.prix || "")}${item.promo ? ` • promo ${escapeHtml(item.promo)}` : ""}</p>
                        <code>${escapeHtml(item.id || "")}</code>
                    </div>
                </article>
            `;
        }).join("");
    }

    function renderBackendInfo() {
        backendBadge.textContent = backendBaseUrl;
    }

    async function authenticateSilently() {
        try {
            await verifyAdminKey(adminKey);
            showApp();
            loadCatalogState();
            setStatus("Session admin restauree.", "success");
        } catch (error) {
            adminKey = "";
            clearAdminKey();
            showLogin();
            setStatus("Reconnectez-vous pour acceder a l'administration.", "pending");
        }
    }

    async function verifyAdminKey(candidate) {
        const response = await fetch(`${backendBaseUrl}/api/admin/session`, {
            method: "POST",
            headers: {
                "X-Admin-Key": candidate
            }
        });

        const result = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(result?.error?.message || "Mot de passe invalide.");
        }
    }

    function adminHeaders(extraHeaders = {}) {
        return {
            "X-Admin-Key": adminKey,
            ...extraHeaders
        };
    }

    function loadAdminKey() {
        try {
            return String(localStorage.getItem(ADMIN_STORAGE_KEY) || "").trim();
        } catch (error) {
            return "";
        }
    }

    function saveAdminKey(value) {
        try {
            localStorage.setItem(ADMIN_STORAGE_KEY, value);
        } catch (error) {
            // Ignore storage issues and continue with in-memory auth.
        }
    }

    function clearAdminKey() {
        try {
            localStorage.removeItem(ADMIN_STORAGE_KEY);
        } catch (error) {
            // Ignore storage issues.
        }
    }

    function showLogin() {
        loginPanel.hidden = false;
        appPanel.hidden = true;
    }

    function showApp() {
        loginPanel.hidden = true;
        appPanel.hidden = false;
    }

    function setStatus(message, tone) {
        status.textContent = message;
        status.dataset.state = tone || "pending";
    }

    function stripTrailingSlash(value) {
        return String(value || "").replace(/\/+$/, "");
    }

    function escapeHtml(value) {
        return String(value || "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;");
    }
})();
