/* Copyright (c) 2026 Ehsan Enaloo. Released under the MIT License. */
/*
  Tunables and page-structure knowledge for the content scripts: request pacing, timeouts, the
  selectors used to drive a site's own menus, and the words that identify its Delete/Archive items
  in different interface languages.
*/
(function (g) {
  'use strict';
  if (g.ABCM?.__skip) return;
  const ABCM = g.ABCM;

  ABCM.define('config', {
    // Request pacing for the API ("fast") path.
    api: {
      timeoutMs: 10000,
      throttleMs: 250,          // minimum gap between request starts, shared by all workers
      concurrency: 3,           // parallel workers in the API phase (the page-UI phase is always serial)
      rateLimitBackoffMs: 2000, // shared cooldown after a 429 before the single retry
      chatgpt: {
        conversation: '/backend-api/conversation/',
        session: '/api/auth/session',
        // Bodies the ChatGPT backend expects for "delete" (hide) and "archive".
        deleteBody: { is_visible: false },
        archiveBody: { is_archived: true }
      },
      claude: { organizations: '/api/organizations' },
      grok: { conversations: '/rest/app-chat/conversations' }
    },

    delays: { short: 100, medium: 200, long: 300, extended: 500 },
    timeouts: { elementWait: 2000, elementWaitShort: 1000 },

    selectors: {
      menuButton: 'button[aria-haspopup="menu"], [role="button"][aria-haspopup="menu"], button[aria-label*="options" i], button[aria-label*="more" i]',
      menu: '[role="menu"], [data-radix-menu-content], [data-slot="dropdown-menu-content"]',
      menuItem: '[role="menuitem"], button[role="menuitem"], button, [data-testid*="delete" i], [data-testid*="archive" i]',
      dialog: '[role="dialog"], [role="alertdialog"]',
      confirmButton: 'button, [role="button"], [data-testid*="delete" i], [data-testid*="confirm" i], button[type="submit"]',
      // Extra ways to find the menu item when its text does not match a known label.
      itemFallbacks: {
        delete: ['div[role="menuitem"] .text-token-text-error', 'div[role="menuitem"][data-testid*="delete" i]'],
        archive: ['div[role="menuitem"][data-testid*="archive" i]']
      }
    },

    // Words that identify the Delete / Archive item of a site's menu in each interface language.
    labels: {
      delete: ['delete', '删除', '刪除', '削除', '삭제', 'löschen', 'supprimer', 'eliminar', 'excluir', 'elimina', 'удалить', 'verwijderen', 'usuń', 'sil', 'hapus', 'xóa', 'ลบ', 'حذف', 'מחק', 'हटाएं', 'ta bort', 'slett', 'slet', 'poista', 'smazat', 'видалити', 'διαγραφή'],
      archive: ['archive', '归档', '封存', 'アーカイブ', '보관', 'archivieren', 'archiver', 'archivar', 'arquivar', 'archivia', 'архивировать', 'archiveren', 'archiwizuj', 'arşivle', 'arsipkan', 'lưu trữ', 'เก็บถาวร', 'أرشفة', 'העבר לארכיון', 'संग्रह करें', 'arkivera', 'arkiver', 'arkivér', 'arkistoi', 'archivovat', 'архівувати', 'αρχειοθέτηση', 'بایگانی']
    }
  });
})(globalThis);
