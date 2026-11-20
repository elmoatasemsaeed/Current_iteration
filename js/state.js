/**
 * Global State, Fast Indexes & Date Engine
 */
let db = {
    users: [],
    vacations: [],
    holidays: [],
    deliveryLogs: [],
    currentStories: [],
    customTags: [],
    backlogStories: [],
    areaComments: [],
    standupCommentsStore: {},
    pullRequests: [],
    workItemsMap: {},
    workItemHistory: {}
};

let currentData = [];
let currentUser = null;

/**
 * O(1) lookup indexes rebuilt whenever data or calendar settings change.
 */
const indexes = {
    storyById: new Map(),
    holidaysSet: new Set(),
    vacationsByPerson: new Map(),
    deliveryLogIds: new Set(),

    rebuildStories() {
        this.storyById.clear();
        const add = (s) => {
            if (!s) return;
            const id = s.id ?? s.ID;
            if (id != null) this.storyById.set(String(id), s);
        };
        (db.currentStories || []).forEach(add);
        (db.backlogStories || []).forEach(add);
        (currentData || []).forEach(add);
    },

    rebuildCalendar() {
        this.holidaysSet = new Set(db.holidays || []);
        this.vacationsByPerson.clear();
        (db.vacations || []).forEach(v => {
            if (!v || !v.name || !v.date) return;
            let set = this.vacationsByPerson.get(v.name);
            if (!set) {
                set = new Set();
                this.vacationsByPerson.set(v.name, set);
            }
            set.add(v.date);
        });
    },

    rebuildDeliveryLogs() {
        this.deliveryLogIds = new Set((db.deliveryLogs || []).map(l => String(l.storyId)));
    },

    rebuildAll() {
        this.rebuildStories();
        this.rebuildCalendar();
        this.rebuildDeliveryLogs();
    }
};

function findStoryById(storyId) {
    if (storyId == null) return null;
    const key = String(storyId);
    if (indexes.storyById.has(key)) return indexes.storyById.get(key);
    return (
        currentData.find(s => String(s.id ?? s.ID) === key) ||
        (db.currentStories || []).find(s => String(s.id ?? s.ID) === key) ||
        (db.backlogStories || []).find(s => String(s.id ?? s.ID) === key) ||
        null
    );
}

/**
 * Permanently strip legacy Project module fields from db and stories.
 */
function cleanProjectArtifacts(targetDb) {
    if (!targetDb || typeof targetDb !== 'object') return targetDb;
    delete targetDb.projects;
    delete targetDb.archivedProjects;
    const stripStory = (s) => {
        if (s && 'linkedProjectId' in s) delete s.linkedProjectId;
    };
    (targetDb.currentStories || []).forEach(stripStory);
    (targetDb.backlogStories || []).forEach(stripStory);
    (currentData || []).forEach(stripStory);
    return targetDb;
}

function ensureDbDefaults(targetDb) {
    if (!targetDb.users) targetDb.users = [];
    if (!targetDb.vacations) targetDb.vacations = [];
    if (!targetDb.holidays) targetDb.holidays = [];
    if (!targetDb.deliveryLogs) targetDb.deliveryLogs = [];
    if (!targetDb.currentStories) targetDb.currentStories = [];
    if (!targetDb.customTags) targetDb.customTags = [];
    if (!targetDb.backlogStories) targetDb.backlogStories = [];
    if (!targetDb.areaComments) targetDb.areaComments = [];
    if (!targetDb.standupCommentsStore) targetDb.standupCommentsStore = {};
    if (!targetDb.pullRequests) targetDb.pullRequests = [];
    if (!targetDb.workItemsMap) targetDb.workItemsMap = {};
    if (!targetDb.workItemHistory) targetDb.workItemHistory = {};
    cleanProjectArtifacts(targetDb);
    return targetDb;
}

// =================================================================
// STANDUP COMMENTS HELPERS
// =================================================================
function getStandupComments(storyId) {
    if (db.standupCommentsStore && db.standupCommentsStore[storyId]) {
        return db.standupCommentsStore[storyId];
    }
    return [];
}

function migrateStandupComments() {
    if (!db.standupCommentsStore) db.standupCommentsStore = {};
    let migrated = false;

    const migrateStories = (stories) => {
        (stories || []).forEach(story => {
            if (story.standupComments && story.standupComments.length > 0) {
                if (!db.standupCommentsStore[story.id]) {
                    db.standupCommentsStore[story.id] = [];
                }
                db.standupCommentsStore[story.id] = story.standupComments;
                delete story.standupComments;
                migrated = true;
            }
        });
    };

    migrateStories(db.currentStories);
    migrateStories(db.backlogStories);

    if (migrated) {
        console.log('✅ Standup comments migrated to central store.');
    }
}

function pruneStandupComments() {
    if (!db.standupCommentsStore) return;

    const activeIds = new Set();
    (db.currentStories || []).forEach(s => activeIds.add(String(s.id)));
    (db.backlogStories || []).forEach(s => activeIds.add(String(s.id)));

    let prunedCount = 0;
    Object.keys(db.standupCommentsStore).forEach(id => {
        if (!activeIds.has(String(id))) {
            delete db.standupCommentsStore[id];
            prunedCount++;
        }
    });

    if (prunedCount > 0) {
        console.log(`🧹 Pruned ${prunedCount} orphaned standup comment entries.`);
    }
}

// =================================================================
// DATE ENGINE (O(1) holiday & vacation lookups)
// =================================================================
const WEEKEND_SET = new Set(CONFIG.WEEKEND);

const dateEngine = {
    _formatIsoDate(date) {
        return date.toISOString().split('T')[0];
    },
    isWorkDay(date, person) {
        if (WEEKEND_SET.has(date.getDay())) return false;
        const dateStr = this._formatIsoDate(date);
        if (indexes.holidaysSet.has(dateStr)) return false;
        const personVacs = indexes.vacationsByPerson.get(person);
        if (personVacs && personVacs.has(dateStr)) return false;
        return true;
    },
    countWorkDaysUntilNow(startDate, personName) {
        if (!startDate) return 0;
        const start = new Date(startDate);
        const today = new Date();
        let count = 0;
        const current = new Date(start);
        while (current <= today) {
            if (this.isWorkDay(current, personName)) count++;
            current.setDate(current.getDate() + 1);
        }
        return count;
    },
    countVacationDaysUntilNow(startDate, personName) {
        if (!startDate) return 0;
        const start = new Date(startDate);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        start.setHours(0, 0, 0, 0);
        if (start > today) return 0;
        let count = 0;
        const current = new Date(start);
        while (current <= today) {
            if (!this.isWorkDay(current, personName)) count++;
            current.setDate(current.getDate() + 1);
        }
        return count;
    },
    countVacationDays(startDate, endDate, person) {
        if (!(startDate instanceof Date) || !(endDate instanceof Date) || isNaN(startDate) || isNaN(endDate)) return 0;
        let count = 0;
        const current = new Date(startDate);
        while (current <= endDate) {
            if (!this.isWorkDay(current, person)) count++;
            current.setDate(current.getDate() + 1);
        }
        return count;
    },
    addWorkingHours(startDate, hours, person) {
        const result = new Date(startDate);
        let remainingHours = hours;
        const hoursPerClockHour = CONFIG.WORKING_HOURS / (CONFIG.END_HOUR - CONFIG.START_HOUR);

        while (!this.isWorkDay(result, person)) {
            result.setDate(result.getDate() + 1);
            result.setHours(CONFIG.START_HOUR, 0, 0, 0);
        }
        while (remainingHours > 0) {
            if (this.isWorkDay(result, person)) {
                const currentHour = result.getHours();
                if (currentHour >= CONFIG.START_HOUR && currentHour < CONFIG.END_HOUR) {
                    remainingHours -= hoursPerClockHour;
                }
            }
            result.setHours(result.getHours() + 1);
            if (result.getHours() >= CONFIG.END_HOUR) {
                result.setDate(result.getDate() + 1);
                result.setHours(CONFIG.START_HOUR, 0, 0, 0);
                while (!this.isWorkDay(result, person)) {
                    result.setDate(result.getDate() + 1);
                }
            }
        }
        return result;
    }
};
