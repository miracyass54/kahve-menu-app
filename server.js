import express from "express";
import http from "http";
import { Server } from "socket.io";
import QRCode from "qrcode";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_FILE = path.join(__dirname, "orders.json");

// ---------------------------------------------------------------------------
// MENÜ — burası artık backend'de, yani menüde değişiklik yaptığınızda tüm
// müşteriler ve mutfak ekranı aynı veriyi görür.
// ---------------------------------------------------------------------------
const MENU = [
  {
    id: "kahveler",
    label: "Kahveler",
    items: [
      { id: "k1", name: "Filtre Kahve", price: 90, desc: "Günün demlemesi" },
      { id: "k2", name: "Flat White", price: 120, desc: "Çift shot, buharda süt" },
      { id: "k3", name: "Karamelli Latte", price: 130, desc: "Ev yapımı karamel" },
      { id: "k4", name: "Cortado", price: 110, desc: "Eşit oranda espresso ve süt" },
    ],
  },
  {
    id: "caylar",
    label: "Çaylar",
    items: [
      { id: "c1", name: "Siyah Çay", price: 40, desc: "Rize, ince belli bardak" },
      { id: "c2", name: "Yeşil Çay", price: 50, desc: "Naneli, buzlu servis de mümkün" },
      { id: "c3", name: "Ihlamur", price: 50, desc: "Taze, limonlu" },
    ],
  },
  {
    id: "tatlilar",
    label: "Tatlılar",
    items: [
      { id: "t1", name: "Cheesecake", price: 140, desc: "Orman meyveli sos" },
      { id: "t2", name: "Brownie", price: 120, desc: "Sıcak servis, dondurma ile" },
      { id: "t3", name: "Sufle", price: 150, desc: "Akışkan çikolata, 12 dk pişer" },
    ],
  },
  {
    id: "atistirmaliklar",
    label: "Atıştırmalıklar",
    items: [
      { id: "a1", name: "Kaşarlı Tost", price: 95, desc: "Tam buğday ekmek" },
      { id: "a2", name: "Simit & Peynir", price: 80, desc: "İki çeşit peynir tabağı" },
      { id: "a3", name: "Kruvasan", price: 85, desc: "Tereyağlı, günlük fırın" },
    ],
  },
];

const TABLES = Array.from({ length: 6 }, (_, i) => ({ id: i + 1, name: `Masa ${i + 1}` }));

// ---------------------------------------------------------------------------
// "VERİTABANI" — şimdilik bir JSON dosyası. Sunucu yeniden başlasa bile
// siparişler kaybolmaz. İleride buranın yerini Postgres/MySQL alabilir,
// API'nin geri kalanı hiç değişmeden çalışmaya devam eder.
// ---------------------------------------------------------------------------
function loadOrders() {
  if (!fs.existsSync(DB_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, "utf-8"));
  } catch {
    return [];
  }
}
function saveOrders(orders) {
  fs.writeFileSync(DB_FILE, JSON.stringify(orders, null, 2));
}

let orders = loadOrders();
let nextId = orders.reduce((max, o) => Math.max(max, o.id), 0) + 1;

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const server = http.createServer(app);
const io = new Server(server);

// --- Menü ve masalar -------------------------------------------------------
app.get("/api/menu", (req, res) => res.json(MENU));
app.get("/api/tables", (req, res) => res.json(TABLES));

// --- QR kod üretimi: her masa için gerçek bir link kodlanır -----------------
app.get("/api/qrcode/:tableId", async (req, res) => {
  try {
    const host = req.headers.host; // örn: 192.168.1.20:3000 (aynı wifi'deki telefon bunu okuyabilir)
    const url = `http://${host}/menu.html?masa=${req.params.tableId}`;
    const dataUrl = await QRCode.toDataURL(url, { margin: 1, width: 220 });
    res.json({ url, dataUrl });
  } catch (err) {
    res.status(500).json({ error: "QR kod üretilemedi" });
  }
});

// --- Siparişler --------------------------------------------------------------
app.get("/api/orders", (req, res) => {
  res.json(orders.filter((o) => o.status !== "Servis Edildi"));
});

app.post("/api/orders", (req, res) => {
  const { tableId, items } = req.body;
  if (!tableId || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: "Geçersiz sipariş" });
  }
  const allItems = MENU.flatMap((c) => c.items);
  const lines = items
    .map(({ itemId, qty }) => {
      const menuItem = allItems.find((i) => i.id === itemId);
      if (!menuItem || qty <= 0) return null;
      return { itemId, name: menuItem.name, price: menuItem.price, qty };
    })
    .filter(Boolean);

  if (lines.length === 0) return res.status(400).json({ error: "Geçersiz ürünler" });

  const total = lines.reduce((sum, l) => sum + l.price * l.qty, 0);
  const order = {
    id: nextId++,
    tableId,
    lines,
    total,
    status: "Yeni",
    createdAt: new Date().toISOString(),
  };
  orders.push(order);
  saveOrders(orders);

  io.emit("orders-changed"); // mutfak ekranına anlık haber ver

  res.json(order);
});

app.patch("/api/orders/:id", (req, res) => {
  const id = Number(req.params.id);
  const { status } = req.body;
  const order = orders.find((o) => o.id === id);
  if (!order) return res.status(404).json({ error: "Sipariş bulunamadı" });

  order.status = status;
  saveOrders(orders);
  io.emit("orders-changed");

  res.json(order);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Kahve Durağı sunucusu çalışıyor: http://localhost:${PORT}`);
});
