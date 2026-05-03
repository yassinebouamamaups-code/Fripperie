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
        siret: ""
    },
    paymentMethods: {
        stripe: {
            enabled: true,
            label: "Stripe",
            description: "Paiement par carte bancaire via Stripe.",
            checkoutUrl: ""
        },
        paypal: {
            enabled: true,
            label: "PayPal",
            description: "Paiement securise via PayPal.",
            checkoutUrl: ""
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
