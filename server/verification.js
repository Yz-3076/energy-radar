// Pluggable "AI recognizes the Monster cans in the photo" step.
//
// This is intentionally NOT wired to a real vision provider yet — the user
// hasn't decided which one to use. Claude's multimodal API is the natural
// default (no model training needed, and this project already has Anthropic
// access), but any vision API — or a human review queue — can implement
// this same `verifyStorePhoto` signature without touching anything else in
// the submission → verification → payment → featured-badge pipeline.
//
// To wire up Claude's API later: send the photo (base64 or a signed URL)
// plus `claimedFlavors`/`claimedCount` to the Messages API with an image
// content block, ask it to confirm whether the photo shows that many
// Monster Energy cans in those flavors, and parse a structured yes/no +
// notes out of the response.

/**
 * @param {string} photoPath - absolute path to the uploaded photo on disk
 * @param {{name: string, price: number}[]} claimedFlavors
 * @param {number} claimedCount
 * @returns {Promise<{ passed: boolean|null, pending: boolean, notes: string }>}
 */
export async function verifyStorePhoto(photoPath, claimedFlavors, claimedCount) {
  // Honest default: we don't auto-approve anything. `passed: null` +
  // `pending: true` means "needs a human," not "looks fine."
  return {
    passed: null,
    pending: true,
    notes:
      "No AI vision provider is configured yet — this submission is queued " +
      "for manual review. See server/verification.js to wire one up.",
  };
}
