// ============================================
// Qwen Chat Navigator - Content Script
// ============================================

(function () {
  'use strict'

  // Selectors configuration
  const SELECTORS = {
    chatContainer: '#chat-message-container',
    userMessage: '.user-message',
    userMessageContent: '.user-message-content',
  }

  // Navigation menu ID
  const MENU_ID = 'qwen-nav-menu'

  // Variable for storing menu reference
  let navigationMenu = null

  // Variable for MutationObserver
  let chatObserver = null

  // Variable for observing container appearance
  let containerObserver = null

  // Variable for URL observer
  let urlObserver = null

  // Current URL
  let currentUrl = window.location.href

  // Initialization flag
  let isInitialized = false

  // Variables for resizing
  let isResizing = false
  let startX = 0
  let startWidth = 0

  // Constants for menu sizes
  const MIN_MENU_WIDTH = 260
  const DEFAULT_MENU_WIDTH = 340
  const STORAGE_KEY = 'qwen-nav-menu-width'

  // Menu state flag (expanded/collapsed)
  let isMenuExpanded = false

  // Variables for tracking message loading stabilization
  let messageCountStabilizationTimer = null
  let lastMessageCount = 0
  let stabilizationAttempts = 0
  const MAX_STABILIZATION_ATTEMPTS = 5
  const STABILIZATION_DELAY = 500

  // ============================================
  // Wait for chat container to appear
  // ============================================

  function waitForChatContainer(maxAttempts = 40, interval = 300) {
    return new Promise((resolve, reject) => {
      let attempts = 0

      const checkContainer = () => {
        const container = document.querySelector(SELECTORS.chatContainer)

        if (container) {
          console.log('[Qwen Navigator] Chat container found')
          resolve(container)
          return
        }

        attempts++

        if (attempts >= maxAttempts) {
          console.warn('[Qwen Navigator] Chat container not found after', maxAttempts, 'attempts')
          // Instead of reject, resolve with null to avoid breaking execution
          resolve(null)
          return
        }

        console.log(`[Qwen Navigator] Attempt ${attempts}/${maxAttempts}...`)
        setTimeout(checkContainer, interval)
      }

      checkContainer()
    })
  }

  // ============================================
  // Extension initialization
  // ============================================

  async function initialize() {
    console.log('[Qwen Navigator] Starting extension initialization... isInitialized =', isInitialized)

    // Reset stabilization counters
    resetStabilization()

    // Create navigation menu immediately (if not already created)
    if (!navigationMenu || !document.getElementById(MENU_ID)) {
      createNavigationMenu()
    }

    try {
      // Wait for chat container to appear
      const container = await waitForChatContainer()

      if (!container) {
        console.warn('[Qwen Navigator] Container not found, but continuing work')
        // Show empty state
        updateNavigationLinks()
        // Start observing for container appearance via MutationObserver
        startObservingForContainer()
        isInitialized = true

        // IMPORTANT: Start URL observer even if container is not found
        if (!urlObserver) {
          startObservingUrl()
        }
        return
      }

      // Start delayed message collection (wait for all to load)
      startMessageStabilization()

      // Start observing new messages
      startObservingChat()

      // Start tracking URL changes (only once on first load)
      if (!urlObserver) {
        startObservingUrl()
      }

      isInitialized = true
      console.log('[Qwen Navigator] Initialization completed successfully')
    } catch (error) {
      console.error('[Qwen Navigator] Initialization error:', error)
      // Even on error, mark as initialized
      isInitialized = true
    }
  }

  // ============================================
  // Reset stabilization counters
  // ============================================

  function resetStabilization() {
    if (messageCountStabilizationTimer) {
      clearTimeout(messageCountStabilizationTimer)
      messageCountStabilizationTimer = null
    }
    lastMessageCount = 0
    stabilizationAttempts = 0
  }

  // ============================================
  // Start message loading stabilization mechanism
  // ============================================

  function startMessageStabilization() {
    console.log('[Qwen Navigator] Starting message loading stabilization mechanism...')

    // Reset previous timer if exists
    resetStabilization()

    // Start check
    checkMessageStabilization()
  }

  // ============================================
  // Check message count stabilization
  // ============================================

  function checkMessageStabilization() {
    const messages = getUserMessages()
    const currentCount = messages.length

    console.log(`[Qwen Navigator] Stabilization check: found ${currentCount} messages (attempt ${stabilizationAttempts + 1}/${MAX_STABILIZATION_ATTEMPTS})`)

    // If message count changed - reset attempt counter
    if (currentCount !== lastMessageCount) {
      console.log(`[Qwen Navigator] Message count changed from ${lastMessageCount} to ${currentCount}, continuing to wait...`)
      lastMessageCount = currentCount
      stabilizationAttempts = 0
    } else {
      // Count hasn't changed - increment counter
      stabilizationAttempts++
      console.log(`[Qwen Navigator] Message count stable (${currentCount}), attempt ${stabilizationAttempts}/${MAX_STABILIZATION_ATTEMPTS}`)
    }

    // If reached max attempts with stable counter - update menu
    if (stabilizationAttempts >= MAX_STABILIZATION_ATTEMPTS) {
      console.log(`[Qwen Navigator] Message loading stabilized at ${currentCount} messages`)
      updateNavigationLinks()
      return
    }

    // Continue checking after delay
    messageCountStabilizationTimer = setTimeout(checkMessageStabilization, STABILIZATION_DELAY)
  }

  // ============================================
  // Create menu HTML structure
  // ============================================

  function createNavigationMenu() {
    // Check if menu already exists
    const existingMenu = document.getElementById(MENU_ID)
    if (existingMenu) {
      console.log('[Qwen Navigator] Menu already exists')
      navigationMenu = existingMenu
      return
    }

    // Create menu container
    navigationMenu = document.createElement('div')
    navigationMenu.id = MENU_ID

    // Restore saved width or use default
    const savedWidth = localStorage.getItem(STORAGE_KEY)
    if (savedWidth) {
      const width = parseInt(savedWidth, 10)
      if (width >= MIN_MENU_WIDTH) {
        navigationMenu.style.width = `${width}px`
      }
    }

    navigationMenu.innerHTML = `
      <div class="qwen-nav-resizer"></div>
      <div class="qwen-nav-header">Chat Navigation (0)</div>
      <div class="qwen-nav-list" id="qwen-nav-list">
        <div class="qwen-nav-empty">Loading...</div>
      </div>
    `

    // Add menu to body
    document.body.appendChild(navigationMenu)

    // Initialize resizing
    initializeResizer()

    console.log('[Qwen Navigator] Menu created')
  }

  // ============================================
  // Collect all user messages
  // ============================================

  function getUserMessages() {
    const chatContainer = document.querySelector(SELECTORS.chatContainer)

    if (!chatContainer) {
      console.log('[Qwen Navigator] Chat container not found')
      return []
    }

    // Find all user messages
    const userMessages = chatContainer.querySelectorAll(SELECTORS.userMessage)

    const messages = []

    userMessages.forEach((messageElement, index) => {
      // Get element ID for anchor
      let messageId = messageElement.id

      // If ID is missing, create temporary unique ID
      if (!messageId) {
        messageId = `qwen-nav-msg-${Date.now()}-${index}`
        messageElement.id = messageId
        console.warn('[Qwen Navigator] Created ID for message without ID:', messageId)
      }

      // Find message text
      const contentElement = messageElement.querySelector(SELECTORS.userMessageContent)

      if (!contentElement) {
        console.warn('[Qwen Navigator] Message text not found:', messageElement)
        return
      }

      // Extract text and replace all line breaks with spaces
      let messageText = contentElement.textContent.trim()

      // If text is empty, skip
      if (!messageText) {
        // Removed logging of empty messages as this is normal during loading
        return
      }

      // Replace all line breaks with spaces and remove multiple spaces
      messageText = messageText.replace(/\s+/g, ' ').trim()

      messages.push({
        id: messageId,
        text: messageText,
        element: messageElement
      })
    })

    console.log(`[Qwen Navigator] Messages found: ${messages.length}`)

    return messages
  }

  // ============================================
  // Update navigation links list
  // ============================================

  function updateNavigationLinks() {
    const messages = getUserMessages()
    const listContainer = document.getElementById('qwen-nav-list')
    const headerElement = document.querySelector('.qwen-nav-header')

    if (!listContainer) {
      console.error('[Qwen Navigator] List container not found')
      return
    }

    if (!headerElement) {
      console.error('[Qwen Navigator] Menu header not found')
      return
    }

    // Update header with message count
    const messageCount = messages.length
    headerElement.textContent = `Chat Navigation (${messageCount})`

    // If no messages, show empty state
    if (messages.length === 0) {
      listContainer.innerHTML = '<div class="qwen-nav-empty">No messages</div>'
      return
    }

    // Generate links HTML
    const linksHTML = messages
      .filter(message => message.id && message.text) // Filter only valid messages
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

    // If no messages left after filtering
    if (!linksHTML) {
      listContainer.innerHTML = '<div class="qwen-nav-empty">No messages</div>'
      // Update counter to 0, as there are no valid messages
      headerElement.textContent = `Chat Navigation (0)`
      return
    }

    listContainer.innerHTML = linksHTML

    // Add click handlers to all links
    const links = listContainer.querySelectorAll('.qwen-nav-item')
    links.forEach(link => {
      link.addEventListener('click', handleLinkClick)
    })

    // Scroll list to last link
    scrollToLastLink()

    console.log('[Qwen Navigator] Links list updated. Message count:', messageCount)
  }

  // ============================================
  // Navigation link click handler
  // ============================================

  function handleLinkClick(event) {
    event.preventDefault()

    const messageId = event.currentTarget.dataset.messageId

    if (!messageId) {
      console.error('[Qwen Navigator] Message ID not found')
      return
    }

    // Find target element
    let targetElement = document.getElementById(messageId)

    if (!targetElement) {
      console.warn(`[Qwen Navigator] Element with ID ${messageId} not found directly, trying selector`)
      // Try to find via selector (ID may have changed)
      targetElement = document.querySelector(`[id="${messageId}"]`)
    }

    if (!targetElement) {
      console.error(`[Qwen Navigator] Element with ID ${messageId} not found. Updating links list...`)
      // Update links list in case structure has changed
      updateNavigationLinks()
      return
    }

    // Smooth scroll to element
    targetElement.scrollIntoView({
      behavior: 'smooth',
      block: 'start',
      inline: 'nearest'
    })

    console.log(`[Qwen Navigator] Scrolled to message: ${messageId}`)
  }

  // ============================================
  // Scroll list to last link
  // ============================================

  function scrollToLastLink() {
    const listContainer = document.getElementById('qwen-nav-list')

    if (!listContainer) return

    const links = listContainer.querySelectorAll('.qwen-nav-item')

    if (links.length === 0) return

    // Get last link
    const lastLink = links[links.length - 1]

    // Scroll to it
    lastLink.scrollIntoView({
      behavior: 'smooth',
      block: 'end'
    })
  }

  // ============================================
  // Track URL changes (chat switching)
  // ============================================

  function startObservingUrl() {
    console.log('[Qwen Navigator] Starting URL change tracking...')

    // Check URL every 500ms
    const checkUrlInterval = setInterval(() => {
      const newUrl = window.location.href

      if (newUrl !== currentUrl) {
        console.log('[Qwen Navigator] ===== URL CHANGE DETECTED =====')
        console.log('[Qwen Navigator] Old URL:', currentUrl)
        console.log('[Qwen Navigator] New URL:', newUrl)

        currentUrl = newUrl

        // CRITICAL: Reset initialization flag FIRST
        isInitialized = false
        console.log('[Qwen Navigator] isInitialized flag reset to false')

        // Stop all observers
        if (chatObserver) {
          console.log('[Qwen Navigator] Stopping chatObserver')
          chatObserver.disconnect()
          chatObserver = null
        }

        if (containerObserver) {
          console.log('[Qwen Navigator] Stopping containerObserver')
          containerObserver.disconnect()
          containerObserver = null
        }

        // Reset stabilization
        console.log('[Qwen Navigator] Resetting stabilization')
        resetStabilization()

        // Clear menu
        const listContainer = document.getElementById('qwen-nav-list')
        const headerElement = document.querySelector('.qwen-nav-header')

        if (listContainer) {
          listContainer.innerHTML = '<div class="qwen-nav-empty">Loading...</div>'
          console.log('[Qwen Navigator] Menu cleared')
        }

        if (headerElement) {
          headerElement.textContent = 'Chat Navigation (0)'
        }

        // Reinitialize extension with delay
        console.log('[Qwen Navigator] Starting reinitialization in 300ms...')
        setTimeout(() => {
          console.log('[Qwen Navigator] Calling initialize() after URL change')
          initialize()
        }, 300)
      }
    }, 500)

    // Save interval in urlObserver for possible stopping
    urlObserver = { interval: checkUrlInterval }

    console.log('[Qwen Navigator] URL change tracking started (interval every 500ms)')
  }

  // ============================================
  // Observe container appearance (if not present yet)
  // ============================================

  function startObservingForContainer() {
    // If observer for container already exists, stop it
    if (containerObserver) {
      containerObserver.disconnect()
    }

    console.log('[Qwen Navigator] Starting observation for chat container appearance...')

    // Observe changes in body
    containerObserver = new MutationObserver((mutations) => {
      // Check if chat container appeared
      const container = document.querySelector(SELECTORS.chatContainer)

      if (container) {
        console.log('[Qwen Navigator] Chat container detected via MutationObserver')

        // Stop observing container appearance
        containerObserver.disconnect()
        containerObserver = null

        // Start delayed message collection
        startMessageStabilization()

        // Start observing new messages
        startObservingChat()
      }
    })

    // Start observing body
    containerObserver.observe(document.body, {
      childList: true,
      subtree: true
    })
  }

  // ============================================
  // Observe chat changes
  // ============================================

  function startObservingChat() {
    const chatContainer = document.querySelector(SELECTORS.chatContainer)

    if (!chatContainer) {
      console.warn('[Qwen Navigator] Chat container not found for observation')
      return
    }

    // If observer already exists, stop it
    if (chatObserver) {
      chatObserver.disconnect()
    }

    // Create MutationObserver to track changes
    chatObserver = new MutationObserver((mutations) => {
      // Check if new elements were added
      let shouldUpdate = false

      mutations.forEach((mutation) => {
        if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
          // Check if added nodes contain user messages
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
        console.log('[Qwen Navigator] New message detected, starting stabilization...')
        // Start stabilization mechanism instead of direct update
        startMessageStabilization()
      }
    })

    // Start observation
    chatObserver.observe(chatContainer, {
      childList: true,
      subtree: true
    })

    console.log('[Qwen Navigator] Chat observation started')
  }

  // ============================================
  // Toggle menu visibility
  // ============================================

  function toggleMenu() {
    if (!navigationMenu) {
      console.error('[Qwen Navigator] Menu not initialized')
      // Try to find menu in DOM
      navigationMenu = document.getElementById(MENU_ID)
      if (!navigationMenu) {
        console.error('[Qwen Navigator] Menu not found in DOM')
        return
      }
    }

    navigationMenu.classList.toggle('visible')

    const isVisible = navigationMenu.classList.contains('visible')
    console.log(`[Qwen Navigator] Menu ${isVisible ? 'opened' : 'closed'}`)
  }

  // ============================================
  // Initialize menu resizing
  // ============================================

  function initializeResizer() {
    const resizer = navigationMenu.querySelector('.qwen-nav-resizer')

    if (!resizer) {
      console.error('[Qwen Navigator] Resize handle not found')
      return
    }

    resizer.addEventListener('mousedown', startResize)
    resizer.addEventListener('dblclick', toggleMenuWidth)

    console.log('[Qwen Navigator] Resizing initialized')
  }

  function startResize(e) {
    isResizing = true
    startX = e.clientX
    startWidth = navigationMenu.offsetWidth

    // Add class to disable transitions
    navigationMenu.classList.add('resizing')

    // Add handlers to document to track mouse movement
    document.addEventListener('mousemove', resize)
    document.addEventListener('mouseup', stopResize)

    // Prevent text selection during dragging
    e.preventDefault()
  }

  function resize(e) {
    if (!isResizing) return

    // Calculate new width
    // clientX decreases when moving left, increases when moving right
    const deltaX = startX - e.clientX
    const newWidth = startWidth + deltaX

    // Apply constraints
    if (newWidth >= MIN_MENU_WIDTH && newWidth <= window.innerWidth) {
      navigationMenu.style.width = `${newWidth}px`
    }
  }

  function stopResize() {
    if (!isResizing) return

    isResizing = false

    // Remove resizing class
    navigationMenu.classList.remove('resizing')

    // Save width to localStorage
    const currentWidth = navigationMenu.offsetWidth
    localStorage.setItem(STORAGE_KEY, currentWidth.toString())

    // Remove handlers
    document.removeEventListener('mousemove', resize)
    document.removeEventListener('mouseup', stopResize)

    console.log('[Qwen Navigator] Menu width saved:', currentWidth)
  }

  // ============================================
  // Toggle menu width (double click)
  // ============================================

  function toggleMenuWidth(e) {
    e.preventDefault()

    // Add resizing class to disable transitions
    navigationMenu.classList.add('resizing')

    if (isMenuExpanded) {
      // Collapse menu to minimum width
      navigationMenu.style.width = `${MIN_MENU_WIDTH}px`
      isMenuExpanded = false
      console.log('[Qwen Navigator] Menu collapsed to minimum width')
    } else {
      // Expand menu to full viewport width
      navigationMenu.style.width = '100vw'
      isMenuExpanded = true
      console.log('[Qwen Navigator] Menu expanded to full width')
    }

    // Remove resizing class after short delay
    setTimeout(() => {
      navigationMenu.classList.remove('resizing')
    }, 50)

    // Save current width state
    const currentWidth = navigationMenu.offsetWidth
    localStorage.setItem(STORAGE_KEY, currentWidth.toString())
  }

  // ============================================
  // Message listener from background script
  // ============================================

  function setupMessageListener() {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      console.log('[Qwen Navigator] Message received:', message)

      if (message.action === 'toggleMenu') {
        toggleMenu()
        sendResponse({ success: true })
      }

      return true // Indicate that response will be asynchronous
    })

    console.log('[Qwen Navigator] Message listener configured')
  }

  // ============================================
  // Helper functions: HTML escaping
  // ============================================

  function escapeHtml(text) {
    const div = document.createElement('div')
    div.textContent = text
    return div.innerHTML
  }

  function escapeAttribute(text) {
    // Create temporary element for safe escaping
    const div = document.createElement('div')
    div.textContent = text
    // Get safe HTML and additionally escape quotes
    return div.innerHTML
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
  }

  // ============================================
  // Start initialization
  // ============================================

  // Set up message listener immediately
  setupMessageListener()

  // Wait for full DOM load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize)
  } else {
    // DOM already loaded, start initialization
    initialize()
  }

})()
