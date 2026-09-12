export async function copyToClipboard(value, navigatorRef = globalThis.navigator, documentRef = globalThis.document) {
  try {
    if (navigatorRef?.clipboard && globalThis.isSecureContext) {
      await navigatorRef.clipboard.writeText(value)
      return true
    }
  } catch {
    // Use the browser fallback below when the secure clipboard API is unavailable.
  }
  try {
    const textarea = documentRef.createElement('textarea')
    textarea.value = value
    textarea.setAttribute('readonly', '')
    textarea.style.position = 'fixed'
    textarea.style.opacity = '0'
    documentRef.body.appendChild(textarea)
    textarea.select()
    const copied = documentRef.execCommand('copy')
    textarea.remove()
    return copied
  } catch {
    return false
  }
}

