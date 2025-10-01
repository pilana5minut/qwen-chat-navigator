// Слушаем клик по иконке расширения
chrome.action.onClicked.addListener(async (tab) => {
  // Проверяем, что мы на нужном сайте
  if (!tab.url || !tab.url.includes('chat.qwen.ai')) {
    console.log('[Qwen Navigator] Расширение работает только на chat.qwen.ai')
    return
  }

  try {
    // Отправляем сообщение в content script активной вкладки
    await chrome.tabs.sendMessage(tab.id, {
      action: 'toggleMenu'
    })
    console.log('[Qwen Navigator] Сообщение отправлено')
  } catch (error) {
    console.error('[Qwen Navigator] Ошибка отправки сообщения:', error)

    // Если content script не загружен, пробуем его внедрить
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content.js']
      })

      // Повторяем попытку отправки сообщения
      setTimeout(async () => {
        try {
          await chrome.tabs.sendMessage(tab.id, {
            action: 'toggleMenu'
          })
        } catch (retryError) {
          console.error('[Qwen Navigator] Повторная попытка не удалась:', retryError)
        }
      }, 100)
    } catch (injectError) {
      console.error('[Qwen Navigator] Не удалось внедрить скрипт:', injectError)
    }
  }
})
