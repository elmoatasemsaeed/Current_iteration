/**
 * Configuration & Core Utilities
 */
const CONFIG = {
    REPO_NAME: "elmoatasemsaeed/Current_iteration",
    FILE_PATH: "db.json",
    ARCHIVE_PATH: "delivery_archive.json",
    WORKING_HOURS: 5,
    START_HOUR: 9,
    END_HOUR: 17,
    WEEKEND: [5, 6], // الجمعة والسبت
    BACKLOG_MONTHS: 2
};

const AZURE_CONFIG = {
    ORG: "NTDotNet",
    PROJECT: "LDM",
    QUERY_ID: "8a732680-07a6-4dff-bdbd-7800644f61b9",
    BACKLOG_QUERY_ID: "8e60a3dd-d754-44d2-95ec-993c4e0d135b",
    TIMEOUT: 120000
};

const HTML_ESCAPE_MAP = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
};

/**
 * Fast HTML character escaping to prevent XSS without DOM allocations.
 */
function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str).replace(/[&<>"']/g, ch => HTML_ESCAPE_MAP[ch]);
}

/**
 * Debounce helper to avoid excessive re-renders during typing.
 */
function debounce(fn, delay = 180) {
    let timer = null;
    return function (...args) {
        clearTimeout(timer);
        timer = setTimeout(() => fn.apply(this, args), delay);
    };
}

function isBacklogStory(story) {
    return Boolean(story && story.isBacklog === true);
}

function isRegularStory(story) {
    return Boolean(story && (story.type === 'User Story' || story.type === 'CR'));
}

async function fetchWithTimeout(url, options = {}) {
    const controller = new AbortController();
    const timeoutMs = AZURE_CONFIG.TIMEOUT;
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const response = await fetch(url, {
            ...options,
            signal: controller.signal
        });
        clearTimeout(timeoutId);
        return response;
    } catch (error) {
        clearTimeout(timeoutId);
        if (error.name === 'AbortError') {
            throw new Error(`انتهت مدة الانتظار (${(timeoutMs / 1000 / 60).toFixed(1)} دقيقة). السيرفر لم يستجب.`);
        }
        throw error;
    }
}
