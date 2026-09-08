import "./style.css";

// Points at the minimal Express backend in monster-tracker/server (run
// `npm run dev` there, defaults to :8790). Change this if you deploy the
// backend elsewhere.
const API = "http://localhost:8790";

const form = document.getElementById("listing-form");
const flavorRows = document.getElementById("flavor-rows");
const addFlavorBtn = document.getElementById("add-flavor");
const dropzone = document.getElementById("dropzone");
const photoInput = document.getElementById("photo-input");
const photoPreview = document.getElementById("photo-preview");
const dropzoneLabel = document.getElementById("dropzone-label");
const formError = document.getElementById("form-error");

const viewForm = document.getElementById("view-form");
const viewStatus = document.getElementById("view-status");
const statusTitle = document.getElementById("status-title");
const statusSub = document.getElementById("status-sub");
const statusPending = document.getElementById("status-pending");
const statusVerified = document.getElementById("status-verified");
const statusFeatured = document.getElementById("status-featured");
const devForceVerifyBtn = document.getElementById("dev-force-verify");
const goSubscribeBtn = document.getElementById("go-subscribe");

function addFlavorRow(name = "", price = "") {
  const row = document.createElement("div");
  row.className = "flavor-row";
  row.innerHTML = `
    <input class="owner-input flavor-name" type="text" placeholder="Flavor (e.g. Ultra Paradise)" value="${name}" required />
    <input class="owner-input flavor-price" type="number" step="0.01" min="0" placeholder="Price" value="${price}" required />
    <button type="button" class="flavor-remove" aria-label="Remove">✕</button>
  `;
  row.querySelector(".flavor-remove").addEventListener("click", () => {
    if (flavorRows.children.length > 1) row.remove();
  });
  flavorRows.appendChild(row);
}
addFlavorRow();
addFlavorRow();
addFlavorBtn.addEventListener("click", () => addFlavorRow());

photoInput.addEventListener("change", () => {
  const file = photoInput.files?.[0];
  if (!file) return;
  photoPreview.src = URL.createObjectURL(file);
  photoPreview.hidden = false;
  dropzoneLabel.hidden = true;
});

function collectFlavors() {
  return [...flavorRows.querySelectorAll(".flavor-row")].map((row) => ({
    name: row.querySelector(".flavor-name").value.trim(),
    price: parseFloat(row.querySelector(".flavor-price").value),
  }));
}

function showError(msg) {
  formError.textContent = msg;
  formError.hidden = false;
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  formError.hidden = true;

  const flavors = collectFlavors();
  if (flavors.some((f) => !f.name || Number.isNaN(f.price))) {
    showError("Every flavor needs a name and a price.");
    return;
  }
  const photo = photoInput.files?.[0];
  if (!photo) {
    showError("A shelf photo is required.");
    return;
  }

  const fd = new FormData();
  fd.append("storeName", form.storeName.value.trim());
  fd.append("address", form.address.value.trim());
  fd.append("flavors", JSON.stringify(flavors));
  fd.append("photo", photo);

  try {
    const res = await fetch(`${API}/api/listings`, { method: "POST", body: fd });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `submit failed (${res.status})`);
    }
    const listing = await res.json();
    localStorage.setItem("mt_listing_id", listing.id);
    enterStatusView(listing);
    // fire the (currently always-pending) verification check right away so
    // the status screen has something real to show, not just "submitted".
    await fetch(`${API}/api/listings/${listing.id}/verify`, { method: "POST" })
      .then((r) => r.json())
      .then(renderStatus)
      .catch(() => {});
  } catch (err) {
    showError(err.message || "Something went wrong submitting your listing.");
  }
});

function enterStatusView(listing) {
  viewForm.hidden = true;
  viewStatus.hidden = false;
  renderStatus(listing);
}

function renderStatus(listing) {
  statusPending.hidden = listing.status !== "pending_verification";
  devForceVerifyBtn.hidden = listing.status !== "pending_verification";
  statusVerified.hidden = !(listing.status === "verified" && !listing.featured);
  statusFeatured.hidden = !listing.featured;

  if (listing.featured) {
    statusTitle.textContent = listing.storeName;
    statusSub.textContent = "Your pin is live and featured on the map.";
  } else if (listing.status === "verified") {
    statusTitle.textContent = "Verified — one step left";
    statusSub.textContent = "Subscribe to go live as a featured pin.";
  } else if (listing.status === "rejected") {
    statusTitle.textContent = "Couldn't verify this submission";
    statusSub.textContent = listing.verificationNotes || "";
  } else {
    statusTitle.textContent = "Reviewing your submission…";
    statusSub.textContent = listing.verificationNotes || "";
  }
}

devForceVerifyBtn.addEventListener("click", async () => {
  const id = localStorage.getItem("mt_listing_id");
  const res = await fetch(`${API}/api/listings/${id}/force-verify`, { method: "POST" });
  renderStatus(await res.json());
});

goSubscribeBtn.addEventListener("click", async () => {
  const id = localStorage.getItem("mt_listing_id");
  goSubscribeBtn.disabled = true;
  const res = await fetch(`${API}/api/listings/${id}/subscribe`, { method: "POST" });
  const { checkoutUrl } = await res.json();
  window.location.href = checkoutUrl;
});

// Handle returning from checkout (mock or real Stripe).
(async function handleReturnFromCheckout() {
  const params = new URLSearchParams(window.location.search);
  const id = params.get("listing") || localStorage.getItem("mt_listing_id");
  if (!id) return;

  if (params.get("mockCheckout") === "1") {
    const res = await fetch(`${API}/api/listings/${id}/mock-complete-checkout`, { method: "POST" });
    const listing = await res.json();
    enterStatusView(listing);
    return;
  }
  if (params.get("checkout") === "success" || params.get("checkout") === "cancel") {
    const res = await fetch(`${API}/api/listings/${id}`);
    if (res.ok) enterStatusView(await res.json());
    return;
  }
  // plain revisit with a listing already in progress this browser
  if (localStorage.getItem("mt_listing_id")) {
    const res = await fetch(`${API}/api/listings/${id}`);
    if (res.ok) enterStatusView(await res.json());
  }
})();
