// Listen for extension icon click
chrome.action.onClicked.addListener(async (tab) => {
  // Check that we are on the correct site
  if (!tab.url || !tab.url.includes('chat.qwen.ai')) {
    console.log('[Qwen Navigator] Extension only works on chat.qwen.ai')
    return
  }

  try {
    // Send message to content script of active tab
    await chrome.tabs.sendMessage(tab.id, {
      action: 'toggleMenu'
    })
    console.log('[Qwen Navigator] Message sent')
  } catch (error) {
    console.error('[Qwen Navigator] Error sending message:', error)

    // If content script is not loaded, try to inject it
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content.js']
      })

      // Retry sending message
      setTimeout(async () => {
        try {
          await chrome.tabs.sendMessage(tab.id, {
            action: 'toggleMenu'
          })
        } catch (retryError) {
          console.error('[Qwen Navigator] Retry attempt failed:', retryError)
        }
      }, 100)
    } catch (injectError) {
      console.error('[Qwen Navigator] Failed to inject script:', injectError)
    }
  }
})
