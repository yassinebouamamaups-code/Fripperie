window.SHOP_CHECKOUT_CONFIG = {
    backend: {
        baseUrl: "https://la-goutte-de-mer-paiements.onrender.com"
    },
    seller: {
        brandName: "La Goutte de Mer Shop",
        email: "lagouttedemer@gmail.com",
        phone: "+33608917053",
        addressLine1: "2 rue Claude Debussy",
        city: "Seysses",
        postalCode: "31600",
        country: "France",
        vatNumber: "",
        siret: "",
        support: {
            whatsappUrl: "https://wa.me/33608917053",
            sourcingInstagramUrl: "https://www.instagram.com/lagouttedemershop/",
            sourcingInstagramLabel: "@lagouttedemershop",
            affordableInstagramUrl: "https://www.instagram.com/maisongouttedemer/",
            affordableInstagramLabel: "@maisongouttedemer"
        }
    },
    paymentMethods: {
        stripe: {
            enabled: true,
            // label: "Stripe",
            // description: "Paiement par carte bancaire via Stripe.",
            checkoutUrl: "",
            secureLabel: "Paiement sécurisé via Stripe",
            supportedMethods: ["CB", "Visa", "Mastercard", "Klarna"]
        },
        paypal: {
            enabled: true,
            // label: "PayPal",
            // description: "Paiement securise via PayPal.",
            checkoutUrl: "",
            secureLabel: "Paiement sécurisé via PayPal"
        }
    },
    emailDelivery: {
        provider: "emailjs",
        publicKey: "j5XdDpsrn0KAWAP_H",
        serviceId: "service_v5rco2h",
        templates: {
            clientSummary: "client_summary",
            clientInvoice: "invoice_template",
            sellerInvoice: "invoice_template"
        }
    },
    documents: {
        invoicePrefix: "FAC"
    }
};

