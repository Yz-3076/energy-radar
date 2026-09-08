import express from "express";
import cors from "cors";
import multer from "multer";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";
import Stripe from "stripe";
import { createListing, getListing, updateListing, listAllListings } from "./store.js";
import { verifyStorePhoto } from "./verification.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 8790;

// Real keys are optional on purpose — without them the subscribe step falls
// back to a clearly-labeled mock checkout so the whole pipeline is still
// runnable end-to-end in dev. Put real test-mode keys in a .env (see
// .env.example) before actually exercising Stripe.
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || "";
const STRIPE_PRICE_ID = process.env.STRIPE_PRICE_ID || "";
const MOCK_STRIPE = !STRIPE_SECRET_KEY;
const stripe = MOCK_STRIPE ? null : new Stripe(STRIPE_SECRET_KEY);

const app = express();
app.use(cors());
app.use(express.json());
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

const upload = multer({
  dest: path.join(__dirname, "uploads"),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
});

/* ------------------------------------------------------------------------
 * POST /api/listings — a store owner's initial submission.
 * multipart/form-data: photo (file), address (text), flavors (JSON string
 * of [{name, price}]).
 * ------------------------------------------------------------------------ */
app.post("/api/listings", upload.single("photo"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "photo is required" });

    let flavors;
    try {
      flavors = JSON.parse(req.body.flavors || "[]");
    } catch {
      return res.status(400).json({ error: "flavors must be a JSON array" });
    }
    if (!Array.isArray(flavors) || flavors.length === 0) {
      return res.status(400).json({ error: "at least one flavor is required" });
    }
    if (!req.body.address || !req.body.address.trim()) {
      return res.status(400).json({ error: "address is required" });
    }
    if (!req.body.storeName || !req.body.storeName.trim()) {
      return res.status(400).json({ error: "storeName is required" });
    }

    const id = crypto.randomUUID();
    const listing = {
      id,
      storeName: req.body.storeName.trim(),
      address: req.body.address.trim(),
      flavors, // [{ name, price }]
      photoUrl: `/uploads/${req.file.filename}`,
      status: "pending_verification", // pending_verification | verified | rejected
      verificationNotes: null,
      featured: false,
      subscriptionStatus: "none", // none | active | past_due | canceled
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await createListing(listing);
    res.status(201).json(listing);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "internal error" });
  }
});

app.get("/api/listings/:id", async (req, res) => {
  const listing = await getListing(req.params.id);
  if (!listing) return res.status(404).json({ error: "not found" });
  res.json(listing);
});

// Only for the map to pull featured/verified listings into its dataset.
app.get("/api/listings", async (_req, res) => {
  res.json(await listAllListings());
});

/* ------------------------------------------------------------------------
 * POST /api/listings/:id/verify — runs the pluggable AI/manual check.
 * Honest by default: with no vision provider wired up (see
 * verification.js), this always comes back pending for a human, never an
 * auto-pass.
 * ------------------------------------------------------------------------ */
app.post("/api/listings/:id/verify", async (req, res) => {
  const listing = await getListing(req.params.id);
  if (!listing) return res.status(404).json({ error: "not found" });

  const photoPath = path.join(__dirname, "uploads", path.basename(listing.photoUrl));
  const claimedCount = listing.flavors.length;
  const result = await verifyStorePhoto(photoPath, listing.flavors, claimedCount);

  const updated = await updateListing(listing.id, {
    status: result.pending ? "pending_verification" : result.passed ? "verified" : "rejected",
    verificationNotes: result.notes,
  });
  res.json(updated);
});

/* ------------------------------------------------------------------------
 * DEV-ONLY — unblocks testing the rest of the pipeline (payment, featured
 * badge) without a real reviewer or a wired-up vision API. Gate this behind
 * real admin auth (or delete it) before this is anything but a local demo.
 * ------------------------------------------------------------------------ */
app.post("/api/listings/:id/force-verify", async (req, res) => {
  if (process.env.NODE_ENV === "production") {
    return res.status(403).json({ error: "disabled in production" });
  }
  const listing = await getListing(req.params.id);
  if (!listing) return res.status(404).json({ error: "not found" });
  const updated = await updateListing(listing.id, {
    status: "verified",
    verificationNotes: "Manually force-verified via the dev-only override.",
  });
  res.json(updated);
});

/* ------------------------------------------------------------------------
 * POST /api/listings/:id/subscribe — start the monthly "featured" billing.
 * Real Stripe test-mode Checkout if keys are configured; otherwise a mock
 * session the frontend can complete without any real payment step.
 * ------------------------------------------------------------------------ */
app.post("/api/listings/:id/subscribe", async (req, res) => {
  const listing = await getListing(req.params.id);
  if (!listing) return res.status(404).json({ error: "not found" });
  if (listing.status !== "verified") {
    return res.status(409).json({ error: "listing must be verified before subscribing" });
  }

  const origin = req.headers.origin || `http://localhost:${req.body.frontendPort || 5180}`;

  if (MOCK_STRIPE) {
    return res.json({
      mock: true,
      checkoutUrl: `${origin}/owner.html?listing=${listing.id}&mockCheckout=1`,
    });
  }

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    line_items: [{ price: STRIPE_PRICE_ID, quantity: 1 }],
    success_url: `${origin}/owner.html?listing=${listing.id}&checkout=success`,
    cancel_url: `${origin}/owner.html?listing=${listing.id}&checkout=cancel`,
    metadata: { listingId: listing.id },
  });
  res.json({ mock: false, checkoutUrl: session.url });
});

// Simulates what the Stripe webhook below would do, for MOCK_STRIPE mode.
app.post("/api/listings/:id/mock-complete-checkout", async (req, res) => {
  if (!MOCK_STRIPE) return res.status(409).json({ error: "not in mock mode" });
  const listing = await getListing(req.params.id);
  if (!listing) return res.status(404).json({ error: "not found" });
  const updated = await updateListing(listing.id, {
    featured: true,
    subscriptionStatus: "active",
  });
  res.json(updated);
});

/* ------------------------------------------------------------------------
 * Real Stripe webhook — flips `featured` on/off as the subscription's
 * lifecycle actually changes. Only reachable when real keys are set.
 * ------------------------------------------------------------------------ */
app.post("/api/stripe/webhook", express.raw({ type: "application/json" }), async (req, res) => {
  if (MOCK_STRIPE) return res.status(409).send("not in mock mode");

  let event;
  try {
    const sig = req.headers["stripe-signature"];
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return res.status(400).send(`webhook signature verification failed: ${err.message}`);
  }

  const listingIdFromSession = (session) => session.metadata?.listingId;

  switch (event.type) {
    case "checkout.session.completed":
    case "invoice.paid": {
      const id = listingIdFromSession(event.data.object);
      if (id) await updateListing(id, { featured: true, subscriptionStatus: "active" });
      break;
    }
    case "customer.subscription.deleted":
    case "invoice.payment_failed": {
      const id = listingIdFromSession(event.data.object);
      if (id) await updateListing(id, { featured: false, subscriptionStatus: "past_due" });
      break;
    }
    default:
      break;
  }
  res.json({ received: true });
});

app.listen(PORT, () => {
  console.log(`monster-tracker server listening on :${PORT}${MOCK_STRIPE ? " (Stripe MOCK mode — no STRIPE_SECRET_KEY set)" : ""}`);
});
