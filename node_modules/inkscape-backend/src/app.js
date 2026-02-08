const express = require("express");
const healthRoutes = require("./routes/health");
const stubRoutes = require("./routes/stub");
const { notFoundHandler, errorHandler } = require("./middleware/errorHandler");

const app = express();
const cors = require("cors");

const configuredOrigins = String(process.env.CORS_ALLOWED_ORIGINS || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

function isAllowedOrigin(origin) {
  if (
    origin === "http://localhost:5173" ||
    origin === "http://localhost:8080" ||
    /^http:\/\/localhost:\d+$/.test(origin) ||
    /^http:\/\/127\.0\.0\.1:\d+$/.test(origin)
  ) {
    return true;
  }

  if (
    origin.endsWith(".vercel.app")
  ) {
    return true;
  }

  if (configuredOrigins.includes(origin)) {
    return true;
  }

  return false;
}

app.use(cors({
  origin: (origin, callback) => {
    // allow server-to-server / curl / same-origin
    if (!origin) return callback(null, true);

    if (isAllowedOrigin(origin)) {
      return callback(null, true);
    }

    return callback(new Error("Not allowed by CORS"));
  },
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "x-dev-user-sub"],
  credentials: false
}));


app.get("/health", (req, res) => {
  res.json({ ok: true });
});



app.use(express.json());

app.use("/api/v1", healthRoutes);
app.use("/api/v1", stubRoutes);

app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
