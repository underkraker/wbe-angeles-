(() => {
    const STORAGE_KEY = 'dreamclean.app.data.v1';
    const API_BASE = window.location.origin.startsWith('http') ? window.location.origin : 'http://127.0.0.1:3000';

    const DEFAULT_DATA = {
        businessName: 'Dream Clean',
        whatsappNumber: '5215512345678',
        logoSrc: 'Gemini_Generated_Image_1ul01j1ul01j1ul0.png',
        localWhatsappEnabled: false,
        localWhatsappEndpoint: 'http://127.0.0.1:3010/send-booking',
        packages: [
            {
                id: 'pkg-basic',
                name: 'BASICO',
                price: 700,
                features: [
                    'Limpieza de Asientos (Textil/Piel)',
                    'Aspirado Profundo en Seco',
                    'Hidratacion de Vestiduras',
                    'Aplicacion de Cera y Aroma'
                ],
                active: true
            },
            {
                id: 'pkg-integral',
                name: 'INTEGRAL',
                price: 900,
                features: [
                    'Todo lo del Basico',
                    'Limpieza de Cinturones',
                    'Limpieza de Cielo Razo',
                    'Areas Dificiles'
                ],
                active: true
            }
        ],
        promotions: [
            {
                id: 'promo-1',
                title: 'Promo de Semana',
                detail: '10% de descuento en el paquete Integral al agendar hoy',
                active: true
            }
        ],
        bookings: []
    };

    function clone(value) {
        return JSON.parse(JSON.stringify(value));
    }

    function normalizeArray(value, fallback) {
        return Array.isArray(value) ? value : fallback;
    }

    function loadData() {
        const fallback = clone(DEFAULT_DATA);
        const raw = localStorage.getItem(STORAGE_KEY);

        if (!raw) {
            return fallback;
        }

        try {
            const parsed = JSON.parse(raw);
            return {
                ...fallback,
                ...parsed,
                packages: normalizeArray(parsed.packages, fallback.packages),
                promotions: normalizeArray(parsed.promotions, fallback.promotions),
                bookings: normalizeArray(parsed.bookings, fallback.bookings)
            };
        } catch (error) {
            return fallback;
        }
    }

    function saveData(data) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
        void pushStateToServer(data);
    }

    function resetData() {
        const clean = clone(DEFAULT_DATA);
        saveData(clean);
        return clean;
    }

    function addBooking(booking) {
        const data = loadData();
        data.bookings.unshift(booking);
        saveData(data);
        void postBookingToServer(booking);
        return data;
    }

    function broadcastUpdate() {
        window.dispatchEvent(new CustomEvent('dreamclean:data-updated'));
    }

    async function fetchStateFromServer() {
        try {
            const response = await fetch(`${API_BASE}/api/state`, {
                method: 'GET',
                cache: 'no-store'
            });

            if (!response.ok) {
                return null;
            }

            const state = await response.json();
            if (!state || typeof state !== 'object') {
                return null;
            }

            localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
            broadcastUpdate();
            return state;
        } catch (error) {
            return null;
        }
    }

    async function pushStateToServer(data) {
        try {
            await fetch(`${API_BASE}/api/state`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(data)
            });
        } catch (error) {
            // Keep local state as source of truth if server is down.
        }
    }

    async function postBookingToServer(booking) {
        try {
            await fetch(`${API_BASE}/api/bookings`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(booking)
            });
        } catch (error) {
            // Keep local booking even if server is down.
        }
    }

    void fetchStateFromServer();

    window.DreamCleanStore = {
        STORAGE_KEY,
        DEFAULT_DATA,
        loadData,
        saveData,
        resetData,
        addBooking,
        fetchStateFromServer
    };
})();
