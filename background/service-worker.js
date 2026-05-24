chrome.action.onClicked.addListener(async (tab) => {
    if (!tab.id || !tab.url) return;
    if (!/^https:\/\//.test(tab.url)) return;

    await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["content/canvas/entrypoints/canvas-panel-content-script.js"],
    });
})
