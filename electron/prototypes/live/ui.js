const status = document.getElementById("status")
const mode = document.getElementById("mode")
document.getElementById("start").onclick = async () => {
  mode.disabled = true
  document.getElementById("start").disabled = true
  try { await window.liveProbe.start(mode.value, text => { status.textContent = text }) }
  catch { status.textContent = "Startup failed. Reload to retry." }
}
document.getElementById("submit").onclick = async () => {
  const result = await window.liveProbe.submit(mode.value === "manual" ? "shortcut" : "silence")
  if (!result) return
  document.getElementById("transcript").value = result.text
  document.getElementById("result").textContent = JSON.stringify({
    reason: result.reason, finalization: result.finalization, completeness: result.completeness,
    closeReason: result.closeReason, fragmentCount: result.fragments.length
  }, null, 2)
}
document.getElementById("cancel").onclick = () => window.liveProbe.cancel()
