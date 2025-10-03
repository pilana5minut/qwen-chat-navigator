// ============================================
// Qwen Chat Navigator - Content Script
// ============================================

(function () {
  'use strict'

  // Конфигурация селекторов
  const SELECTORS = {
    chatContainer: '#chat-message-container',
    userMessage: '.user-message',
    userMessageContent: '.user-message-content',
  }

  // ID меню навигации
  const MENU_ID = 'qwen-nav-menu'

  // Переменная для хранения ссылки на меню
  let navigationMenu = null

  // Переменная для MutationObserver
  let chatObserver = null

  // Переменная для URL observer
  let urlObserver = null

  // Текущий URL
  let currentUrl = window.location.href

  // Флаг инициализации
  let isInitialized = false

  // Переменные для изменения размера
  let isResizing = false
  let startX = 0
  let startWidth = 0

  // Константы для размеров меню
  const MIN_MENU_WIDTH = 260
  const DEFAULT_MENU_WIDTH = 340
  const STORAGE_KEY = 'qwen-nav-menu-width'

  // Флаг состояния меню (развернуто/свернуто)
  let isMenuExpanded = false

  // ============================================
  // Ожидание появления контейнера чата
  // ============================================

  function waitForChatContainer(maxAttempts = 20, interval = 500) {
    return new Promise((resolve, reject) => {
      let attempts = 0

      const checkContainer = () => {
        const container = document.querySelector(SELECTORS.chatContainer)

        if (container) {
          console.log('[Qwen Navigator] Контейнер чата найден')
          resolve(container)
          return
        }

        attempts++

        if (attempts >= maxAttempts) {
          console.error('[Qwen Navigator] Контейнер чата не найден после', maxAttempts, 'попыток')
          reject(new Error('Chat container not found'))
          return
        }

        console.log(`[Qwen Navigator] Попытка ${attempts}/${maxAttempts}...`)
        setTimeout(checkContainer, interval)
      }

      checkContainer()
    })
  }

  // ============================================
  // Инициализация расширения
  // ============================================

  async function initialize() {
    if (isInitialized) {
      console.log('[Qwen Navigator] Расширение уже инициализировано')
      return
    }

    console.log('[Qwen Navigator] Начало инициализации расширения...')

    // Создаём меню навигации сразу
    createNavigationMenu()

    try {
      // Ждём появления контейнера чата
      await waitForChatContainer()

      // Собираем существующие сообщения
      updateNavigationLinks()

      // Запускаем наблюдение за новыми сообщениями
      startObservingChat()

      // Запускаем отслеживание смены URL
      if (!urlObserver) {
        startObservingUrl()
      }

      isInitialized = true
      console.log('[Qwen Navigator] Инициализация завершена успешно')
    } catch (error) {
      console.error('[Qwen Navigator] Ошибка инициализации:', error)
    }
  }

  // ============================================
  // Создание HTML структуры меню
  // ============================================

  function createNavigationMenu() {
    // Проверяем, не создано ли меню уже
    const existingMenu = document.getElementById(MENU_ID)
    if (existingMenu) {
      console.log('[Qwen Navigator] Меню уже существует')
      navigationMenu = existingMenu
      return
    }

    // Создаём контейнер меню
    navigationMenu = document.createElement('div')
    navigationMenu.id = MENU_ID

    // Восстанавливаем сохранённую ширину или используем дефолтную
    const savedWidth = localStorage.getItem(STORAGE_KEY)
    if (savedWidth) {
      const width = parseInt(savedWidth, 10)
      if (width >= MIN_MENU_WIDTH) {
        navigationMenu.style.width = `${width}px`
      }
    }

    navigationMenu.innerHTML = `
      <div class="qwen-nav-resizer"></div>
      <div class="qwen-nav-header">Навигация по чату</div>
      <div class="qwen-nav-list" id="qwen-nav-list">
        <div class="qwen-nav-empty">Загрузка...</div>
      </div>
    `

    // Добавляем меню в body
    document.body.appendChild(navigationMenu)

    // Инициализируем изменение размера
    initializeResizer()

    console.log('[Qwen Navigator] Меню создано')
  }

  // ============================================
  // Сбор всех сообщений пользователя
  // ============================================

  function getUserMessages() {
    const chatContainer = document.querySelector(SELECTORS.chatContainer)

    if (!chatContainer) {
      console.log('[Qwen Navigator] Контейнер чата не найден')
      return []
    }

    // Находим все сообщения пользователя
    const userMessages = chatContainer.querySelectorAll(SELECTORS.userMessage)

    const messages = []

    userMessages.forEach((messageElement, index) => {
      // Получаем ID элемента для скора
      let messageId = messageElement.id

      // Если ID отсутствует, создаём временный уникальный ID
      if (!messageId) {
        messageId = `qwen-nav-msg-${Date.now()}-${index}`
        messageElement.id = messageId
        console.warn('[Qwen Navigator] Создан ID для сообщения без ID:', messageId)
      }

      // Находим текст сообщения
      const contentElement = messageElement.querySelector(SELECTORS.userMessageContent)

      if (!contentElement) {
        console.warn('[Qwen Navigator] Текст сообщения не найден:', messageElement)
        return
      }

      // Извлекаем текст и заменяем все переносы строк на пробелы
      let messageText = contentElement.textContent.trim()

      // Если текст пустой, пропускаем
      if (!messageText) {
        console.warn('[Qwen Navigator] Пустое сообщение пропущено')
        return
      }

      // Заменяем все переносы строк на пробелы и убираем множественные пробелы
      messageText = messageText.replace(/\s+/g, ' ').trim()

      messages.push({
        id: messageId,
        text: messageText,
        element: messageElement
      })
    })

    console.log(`[Qwen Navigator] Найдено сообщений: ${messages.length}`)

    return messages
  }

  // ============================================
  // Обновление списка навигационных ссылок
  // ============================================

  function updateNavigationLinks() {
    const messages = getUserMessages()
    const listContainer = document.getElementById('qwen-nav-list')

    if (!listContainer) {
      console.error('[Qwen Navigator] Контейнер списка не найден')
      return
    }

    // Если нет сообщений, показываем пустое состояние
    if (messages.length === 0) {
      listContainer.innerHTML = '<div class="qwen-nav-empty">Нет сообщений</div>'
      return
    }

    // Генерируем HTML ссылок
    const linksHTML = messages
      .filter(message => message.id && message.text) // Фильтруем только валидные сообщения
      .map((message, index) => {
        return `
          <a href="#${message.id}"
             class="qwen-nav-item"
             data-message-id="${message.id}"
             title="${escapeAttribute(message.text)}">
            ${escapeHtml(message.text)}
          </a>
        `
      }).join('')

    // Если после фильтрации не осталось сообщений
    if (!linksHTML) {
      listContainer.innerHTML = '<div class="qwen-nav-empty">Нет сообщений</div>'
      return
    }

    listContainer.innerHTML = linksHTML

    // Добавляем обработчики клика на все ссылки
    const links = listContainer.querySelectorAll('.qwen-nav-item')
    links.forEach(link => {
      link.addEventListener('click', handleLinkClick)
    })

    // Прокручиваем список к последней ссылке
    scrollToLastLink()

    console.log('[Qwen Navigator] Список ссылок обновлён')
  }

  // ============================================
  // Обработчик клика по ссылке навигации
  // ============================================

  function handleLinkClick(event) {
    event.preventDefault()

    const messageId = event.currentTarget.dataset.messageId

    if (!messageId) {
      console.error('[Qwen Navigator] ID сообщения не найден')
      return
    }

    // Находим целевой элемент
    let targetElement = document.getElementById(messageId)

    if (!targetElement) {
      console.warn(`[Qwen Navigator] Элемент с ID ${messageId} не найден напрямую, пробуем найти через селектор`)
      // Пробуем найти через селектор (возможно ID изменился)
      targetElement = document.querySelector(`[id="${messageId}"]`)
    }

    if (!targetElement) {
      console.error(`[Qwen Navigator] Элемент с ID ${messageId} не найден. Обновляем список ссылок...`)
      // Обновляем список ссылок на случай если структура изменилась
      updateNavigationLinks()
      return
    }

    // Плавная прокрутка к элементу
    targetElement.scrollIntoView({
      behavior: 'smooth',
      block: 'start',
      inline: 'nearest'
    })

    console.log(`[Qwen Navigator] Прокрутка к сообщению: ${messageId}`)
  }

  // ============================================
  // Прокрутка списка к последней ссылке
  // ============================================

  function scrollToLastLink() {
    const listContainer = document.getElementById('qwen-nav-list')

    if (!listContainer) return

    const links = listContainer.querySelectorAll('.qwen-nav-item')

    if (links.length === 0) return

    // Получаем последнюю ссылку
    const lastLink = links[links.length - 1]

    // Прокручиваем к ней
    lastLink.scrollIntoView({
      behavior: 'smooth',
      block: 'end'
    })
  }

  // ============================================
  // Отслеживание смены URL (переключение чатов)
  // ============================================

  function startObservingUrl() {
    // Проверяем URL каждые 500мс
    const checkUrlInterval = setInterval(() => {
      const newUrl = window.location.href

      if (newUrl !== currentUrl) {
        console.log('[Qwen Navigator] Обнаружена смена URL')
        console.log('[Qwen Navigator] Старый URL:', currentUrl)
        console.log('[Qwen Navigator] Новый URL:', newUrl)

        currentUrl = newUrl

        // Сбрасываем флаг инициализации
        isInitialized = false

        // Останавливаем старый observer
        if (chatObserver) {
          chatObserver.disconnect()
          chatObserver = null
        }

        // Переинициализируем расширение для нового чата
        setTimeout(initialize, 500)
      }
    }, 500)

    // Сохраняем интервал в urlObserver для возможности остановки
    urlObserver = { interval: checkUrlInterval }

    console.log('[Qwen Navigator] Отслеживание смены URL запущено')
  }

  // ============================================
  // Наблюдение за изменениями в чате
  // ============================================

  function startObservingChat() {
    const chatContainer = document.querySelector(SELECTORS.chatContainer)

    if (!chatContainer) {
      console.error('[Qwen Navigator] Контейнер чата не найден для наблюдения')
      return
    }

    // Создаём MutationObserver для отслеживания изменений
    chatObserver = new MutationObserver((mutations) => {
      // Проверяем, были ли добавлены новые элементы
      let shouldUpdate = false

      mutations.forEach((mutation) => {
        if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
          // Проверяем, есть ли среди добавленных узлов сообщения пользователя
          mutation.addedNodes.forEach((node) => {
            if (node.nodeType === Node.ELEMENT_NODE) {
              if (node.classList && node.classList.contains('user-message')) {
                shouldUpdate = true
              } else if (node.querySelector && node.querySelector(SELECTORS.userMessage)) {
                shouldUpdate = true
              }
            }
          })
        }
      })

      if (shouldUpdate) {
        console.log('[Qwen Navigator] Обнаружено новое сообщение')
        // Небольшая задержка, чтобы DOM успел обновиться
        setTimeout(updateNavigationLinks, 100)
      }
    })

    // Начинаем наблюдение
    chatObserver.observe(chatContainer, {
      childList: true,
      subtree: true
    })

    console.log('[Qwen Navigator] Наблюдение за чатом запущено')
  }

  // ============================================
  // Переключение видимости меню
  // ============================================

  function toggleMenu() {
    if (!navigationMenu) {
      console.error('[Qwen Navigator] Меню не инициализировано')
      // Пробуем найти меню в DOM
      navigationMenu = document.getElementById(MENU_ID)
      if (!navigationMenu) {
        console.error('[Qwen Navigator] Меню не найдено в DOM')
        return
      }
    }

    navigationMenu.classList.toggle('visible')

    const isVisible = navigationMenu.classList.contains('visible')
    console.log(`[Qwen Navigator] Меню ${isVisible ? 'открыто' : 'закрыто'}`)
  }

  // ============================================
  // Инициализация изменения размера меню
  // ============================================

  function initializeResizer() {
    const resizer = navigationMenu.querySelector('.qwen-nav-resizer')

    if (!resizer) {
      console.error('[Qwen Navigator] Ручка изменения размера не найдена')
      return
    }

    resizer.addEventListener('mousedown', startResize)
    resizer.addEventListener('dblclick', toggleMenuWidth)

    console.log('[Qwen Navigator] Изменение размера инициализировано')
  }

  function startResize(e) {
    isResizing = true
    startX = e.clientX
    startWidth = navigationMenu.offsetWidth

    // Добавляем класс для отключения transitions
    navigationMenu.classList.add('resizing')

    // Добавляем обработчики на document для отслеживания движения мыши
    document.addEventListener('mousemove', resize)
    document.addEventListener('mouseup', stopResize)

    // Предотвращаем выделение текста во время перетаскивания
    e.preventDefault()
  }

  function resize(e) {
    if (!isResizing) return

    // Вычисляем новую ширину
    // clientX уменьшается при движении влево, увеличивается при движении вправо
    const deltaX = startX - e.clientX
    const newWidth = startWidth + deltaX

    // Применяем ограничения
    if (newWidth >= MIN_MENU_WIDTH && newWidth <= window.innerWidth) {
      navigationMenu.style.width = `${newWidth}px`
    }
  }

  function stopResize() {
    if (!isResizing) return

    isResizing = false

    // Убираем класс resizing
    navigationMenu.classList.remove('resizing')

    // Сохраняем ширину в localStorage
    const currentWidth = navigationMenu.offsetWidth
    localStorage.setItem(STORAGE_KEY, currentWidth.toString())

    // Удаляем обработчики
    document.removeEventListener('mousemove', resize)
    document.removeEventListener('mouseup', stopResize)

    console.log('[Qwen Navigator] Ширина меню сохранена:', currentWidth)
  }

  // ============================================
  // Переключение ширины меню (двойной клик)
  // ============================================

  function toggleMenuWidth(e) {
    e.preventDefault()

    // Добавляем класс resizing для отключения transitions
    navigationMenu.classList.add('resizing')

    if (isMenuExpanded) {
      // Сворачиваем меню до минимальной ширины
      navigationMenu.style.width = `${MIN_MENU_WIDTH}px`
      isMenuExpanded = false
      console.log('[Qwen Navigator] Меню свернуто до минимальной ширины')
    } else {
      // Разворачиваем меню на всю ширину вьюпорта
      navigationMenu.style.width = '100vw'
      isMenuExpanded = true
      console.log('[Qwen Navigator] Меню развернуто на всю ширину')
    }

    // Убираем класс resizing через небольшую задержку
    setTimeout(() => {
      navigationMenu.classList.remove('resizing')
    }, 50)

    // Сохраняем текущее состояние ширины
    const currentWidth = navigationMenu.offsetWidth
    localStorage.setItem(STORAGE_KEY, currentWidth.toString())
  }

  // ============================================
  // Слушатель сообщений от background script
  // ============================================

  function setupMessageListener() {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      console.log('[Qwen Navigator] Получено сообщение:', message)

      if (message.action === 'toggleMenu') {
        toggleMenu()
        sendResponse({ success: true })
      }

      return true // Указываем, что ответ будет асинхронным
    })

    console.log('[Qwen Navigator] Слушатель сообщений настроен')
  }

  // ============================================
  // Вспомогательные функции: экранирование HTML
  // ============================================

  function escapeHtml(text) {
    const div = document.createElement('div')
    div.textContent = text
    return div.innerHTML
  }

  function escapeAttribute(text) {
    // Создаем временный элемент для безопасного экранирования
    const div = document.createElement('div')
    div.textContent = text
    // Получаем безопасный HTML и дополнительно экранируем кавычки
    return div.innerHTML
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
  }

  // ============================================
  // Запуск инициализации
  // ============================================

  // Настраиваем слушатель сообщений сразу
  setupMessageListener()

  // Ждём полной загрузки DOM
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize)
  } else {
    // DOM уже загружен, запускаем инициализацию
    initialize()
  }

})()
