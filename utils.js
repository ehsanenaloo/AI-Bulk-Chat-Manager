/* Copyright (c) 2026 Ehsan Enaloo. Released under the MIT License. */
if (typeof window.utilsLoaded === "undefined") {
  console.log("utils.js loaded");

  window.utilsLoaded = true;

  // Common utility functions
  const CommonUtils = {
    // Delay utility
    delay(ms) {
      return new Promise(resolve => setTimeout(resolve, ms));
    },

    // Generate timestamp
    generateTimestamp() {
      return new Date().toISOString().replace("T", " ").substr(0, 19);
    },

    // Safe element query with timeout
    async waitForElement(selector, parent = document, timeout = UI_CONFIG.TIMEOUTS.ELEMENT_WAIT) {
      const startedAt = Date.now();
      while (Date.now() - startedAt < timeout) {
        const element = parent.querySelector(selector);
        if (element) return element;
        await this.delay(UI_CONFIG.DELAYS.SHORT);
      }
      throw new Error(`Element ${selector} not found within ${timeout}ms`);
    },

    // Wait for element to disappear
    async waitForElementToDisappear(selector, timeout = UI_CONFIG.TIMEOUTS.ELEMENT_WAIT) {
      const startedAt = Date.now();
      while (Date.now() - startedAt < timeout) {
        const element = document.querySelector(selector);
        if (!element) return;
        await this.delay(UI_CONFIG.DELAYS.SHORT);
      }
      throw new Error(`Element ${selector} did not disappear within ${timeout}ms`);
    },

    // Find element by text content (legacy method)
    async waitForElementByText(selector, textOptions, parent = document, timeout = UI_CONFIG.TIMEOUTS.ELEMENT_WAIT) {
      const startedAt = Date.now();
      const texts = Array.isArray(textOptions) ? textOptions : [textOptions];

      while (Date.now() - startedAt < timeout) {
        const elements = parent.querySelectorAll(selector);
        const element = Array.from(elements).find(el => {
          const textContent = el.textContent.trim();
          return texts.some(text =>
            textContent === text ||
            textContent.includes(text) ||
            (text === UI_CONFIG.STRINGS.DELETE && el.querySelector(".text-token-text-error"))
          );
        });
        if (element) return element;
        await this.delay(UI_CONFIG.DELAYS.SHORT);
      }
      return null;
    },

    // Find element using multiple strategies (language-independent)
    async waitForElementByStrategy(operation, parent = document, timeout = UI_CONFIG.TIMEOUTS.ELEMENT_WAIT) {
      const strategies = UI_CONFIG.BUTTON_STRATEGIES[operation.toUpperCase()];
      if (!strategies) {
        throw new Error(`No strategies defined for operation: ${operation}`);
      }

      const startedAt = Date.now();
      
      while (Date.now() - startedAt < timeout) {
        for (const strategy of strategies) {
          if (strategy === 'text-fallback') {
            // Fallback to text matching with multiple languages
            // Dynamically get all strings for the operation
            const prefix = operation === 'DELETE' ? 'DELETE' : 'ARCHIVE';
            const textOptions = Object.entries(UI_CONFIG.STRINGS)
              .filter(([key]) => key === prefix || key.startsWith(prefix + '_'))
              .map(([, value]) => value);
            
            const elements = parent.querySelectorAll('div[role="menuitem"]');
            const element = Array.from(elements).find(el => {
              const textContent = el.textContent.trim();
              return textOptions.some(text =>
                textContent === text || textContent.includes(text)
              );
            });

            if (element) {
              console.log(`Found ${operation} button using text fallback strategy, text: "${element.textContent.trim()}"`);
              return element;
            }
          } else {
            // Try CSS selector strategy
            const element = parent.querySelector(strategy);
            if (element) {
              console.log(`Found ${operation} button using strategy: ${strategy}`);
              return element;
            }
          }
        }
        
        await this.delay(UI_CONFIG.DELAYS.SHORT);
      }
      
      return null;
    },

    // Get selected conversations
    getSelectedConversations() {
      return [...document.querySelectorAll(UI_CONFIG.SELECTORS.conversationsCheckbox)];
    },

    // Remove all checkboxes
    removeAllCheckboxes() {
      const checkboxes = document.querySelectorAll(`.${CSS_CLASSES.CHECKBOX}`);
      checkboxes.forEach(checkbox => checkbox.remove());
    },

    // Show notification
    showNotification(message, type = 'info') {
      console.log(`[${type.toUpperCase()}] ${message}`);
      if (type === 'error') {
        alert(message);
      }
    }
  };

  // Chrome API utilities
  const ChromeUtils = {
    // Get user info with error handling
    getUserInfo() {
      return Promise.resolve({ id: "local-only" });
    },

    // Send progress update
    sendProgress(buttonId, progress, meta = {}) {
      chrome.runtime.sendMessage({
        action: "updateProgress",
        buttonId: buttonId,
        progress: progress,
        meta: meta
      });
    },

    // Send operation complete
    sendComplete(buttonId, meta = {}) {
      chrome.runtime.sendMessage({
        action: "operationComplete",
        buttonId: buttonId,
        meta: meta
      });
    }
  };

  // API utilities
  const APIUtils = {
    async makeRequest() {
      return {};
    },

    async sendEvent() {
      return { ok: true };
    },

    async checkPaymentStatus() {
      return { isPaid: true };
    }
  };

  // Export to global scope
  window.CommonUtils = CommonUtils;
  window.ChromeUtils = ChromeUtils;
  window.APIUtils = APIUtils;

  // For backward compatibility
  window.getUserInfo = ChromeUtils.getUserInfo;
  window.sendEventAsync = APIUtils.sendEvent;

} else {
  console.log("utils.js already loaded, skipping re-initialization");
}
