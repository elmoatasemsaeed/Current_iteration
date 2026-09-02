/**
 * Configuration & Global State
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
    BACKLOG_QUERY_ID: "8e60a3dd-d754-44d2-95ec-993c4e0d135b"
};

/**
 * Escapes HTML special characters to prevent XSS attacks.
 */
function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    const div = document.createElement('div');
    div.textContent = str.toString();
    return div.innerHTML;
}

let db = {
    users: [],
    vacations: [],
    holidays: [],
    deliveryLogs: [],
    currentStories: [],
    customTags: [],
    backlogStories: [],
    areaComments: [],
    projects: [],
    archivedProjects: [],
    standupCommentsStore: {}
};

let currentData = [];
let currentUser = null;

function isBacklogStory(story) {
    return story && story.isBacklog === true;
}
function isRegularStory(story) {
    return story && (story.type === 'User Story' || story.type === 'CR');
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
    (db.currentStories || []).forEach(s => activeIds.add(s.id.toString()));
    (db.backlogStories || []).forEach(s => activeIds.add(s.id.toString()));

    let prunedCount = 0;
    Object.keys(db.standupCommentsStore).forEach(id => {
        if (!activeIds.has(id.toString())) {
            delete db.standupCommentsStore[id];
            prunedCount++;
        }
    });

    if (prunedCount > 0) {
        console.log(`🧹 Pruned ${prunedCount} orphaned standup comment entries.`);
    }
}

// =================================================================
// HELPER FUNCTIONS (UPDATED WITH NEW CLASSES)
// =================================================================

function renderTagDropdown(storyId, selectedTags = []) {
    const customTagsList = db.customTags || [];
    if (customTagsList.length === 0) return '';
    return `
        <div class="relative inline-block group">
            <button class="w-6 h-6 flex items-center justify-center rounded-full bg-gray-50 border border-gray-200 text-gray-400 hover:bg-indigo-50 hover:text-indigo-600 transition-all pb-0.5">
                <span class="text-sm font-bold">+</span>
            </button>
            <div class="hidden group-hover:block absolute left-0 top-full mt-0 pt-2 w-48 z-[999]">
                <div class="bg-white border border-gray-100 shadow-2xl rounded-lg py-1 overflow-hidden">
                    <div class="px-3 py-1.5 text-[9px] font-bold text-gray-400 border-b border-gray-50 bg-gray-50/50">Select Tag</div>
                    <div class="max-h-40 overflow-y-auto">
                        ${customTagsList.map(tag => {
                            const isPicked = selectedTags.includes(tag);
                            return `
                                <button onclick="tagManager.toggleTagInStory('${storyId}', '${encodeURIComponent(tag)}')" 
                                        class="w-full text-left px-3 py-2 text-[11px] font-medium ${isPicked ? 'bg-purple-50 text-purple-700' : 'text-slate-600 hover:bg-indigo-50 hover:text-indigo-600'} transition-colors flex items-center justify-between">
                                    ${escapeHtml(tag)}
                                    ${isPicked ? '<span class="text-purple-600 font-bold">✓</span>' : ''}
                                </button>
                            `;
                        }).join('')}
                    </div>
                </div>
            </div>
        </div>
    `;
}

function renderProjectSelect(story) {
    const projectOptions = db.projects.filter(p => p.status !== 'closed').map(p => 
        `<option value="${escapeHtml(p.id)}" ${story.linkedProjectId === p.id ? 'selected' : ''}>${escapeHtml(p.name)}</option>`
    ).join('');
    if (!projectOptions) return '';
    return `
        <div class="mt-2 flex items-center gap-2 border-t border-dashed border-gray-200 pt-2">
            <span class="text-[10px] font-bold text-gray-400">📁 Project:</span>
            <select onchange="projectManager.linkStoryToProject('${story.id}', this.value)" class="form-input form-input-sm flex-1">
                <option value="">None</option>
                ${projectOptions}
            </select>
            ${story.linkedProjectId ? `<button onclick="projectManager.unlinkStoryFromProject('${story.id}')" class="text-red-400 hover:text-red-600 text-xs font-bold">✕</button>` : ''}
        </div>
    `;
}

function renderComments(story) {
    const comments = getStandupComments(story.id);
    if (!comments.length) return '';
    return `
        <div class="space-y-2 max-h-28 overflow-y-auto pr-1">
            ${comments.slice().reverse().map(c => `
                <div class="bg-white p-2 rounded-lg border border-indigo-100/50 shadow-sm">
                    <div class="flex justify-between items-center mb-1">
                        <span class="text-[9px] font-bold text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded">${escapeHtml(c.date)}</span>
                    </div>
                    <p class="text-[11px] text-slate-600 leading-tight italic">"${escapeHtml(c.text)}"</p>
                </div>
            `).join('')}
        </div>
    `;
}

/**
 * Unified story card generator (Updated with new classes)
 */
function createStoryCard(story, options = {}) {
    const {
        mode = 'regular',
        showProjectSelect = true,
        showTagDropdown = true,
        showCommentsButton = true,
        customClass = '',
        showStatus = true,
    } = options;

    const isBacklog = mode === 'backlog';
    const isSupport = mode === 'support';

    const tags = [...new Set([...(story.tags || []), ...(story.customTags || [])])];
    const commentsCount = getStandupComments(story.id).length;
    const releaseDate = story.expectedRelease ? (story.expectedRelease instanceof Date ? story.expectedRelease.toLocaleDateString('en-GB') : new Date(story.expectedRelease).toLocaleDateString('en-GB')) : null;

    let statusHtml = '';
    if (showStatus && !isBacklog) {
        const state = story.state || '';
        let statusClass = 'status-active';
        if (state === 'Tested') statusClass = 'status-tested';
        else if (state === 'Delayed') statusClass = 'status-delayed';
        else if (state === 'On-Hold') statusClass = 'status-onhold';
        else if (state === 'Closed') statusClass = 'status-closed';
        statusHtml = `<span class="status-badge ${statusClass}">${escapeHtml(state)}</span>`;
    }

    let projectSelectHtml = showProjectSelect && !isBacklog ? renderProjectSelect(story) : '';
    let tagDropdownHtml = showTagDropdown ? renderTagDropdown(story.id, story.customTags || []) : '';
    let commentsHtml = showCommentsButton && !isBacklog ? 
        `<button onclick="ui.openCommentsModal('${story.id}')" class="btn btn-outline text-indigo-600 border-indigo-300 hover:bg-indigo-50 text-xs py-1 px-2">💬 <span class="font-bold">${commentsCount}</span></button>` : '';

    let extraFields = '';
    if (isBacklog) {
        extraFields = `
            <div class="grid grid-cols-2 gap-2 border-t pt-2 text-[11px]">
                <div><div class="text-gray-400 uppercase font-bold text-[9px]">Area</div><div class="text-slate-700 truncate">${escapeHtml(story.area)}</div></div>
                <div><div class="text-gray-400 uppercase font-bold text-[9px]">Priority</div><div class="text-slate-700 font-bold">P${escapeHtml(story.priority)}</div></div>
            </div>
        `;
    } else if (isSupport) {
        extraFields = `
            <div class="grid grid-cols-2 gap-2 border-t pt-2 text-[11px]">
                <div><div class="text-gray-400 uppercase font-bold text-[9px]">Assigned To</div><div class="text-slate-700 truncate font-medium">${escapeHtml(story.assignedTo)}</div></div>
                <div><div class="text-gray-400 uppercase font-bold text-[9px]">Priority</div><div class="text-slate-700 font-bold">P${escapeHtml(story.priority)}</div></div>
            </div>
            <div class="text-[10px] text-gray-400 mt-2 border-t border-gray-100 pt-1">Area: ${escapeHtml(story.area || "General")} | Updated: ${story.changedDate ? new Date(story.changedDate).toLocaleDateString('en-GB') : 'N/A'}</div>
        `;
    } else {
        // regular mode
        const devEst = story.tasks.filter(t => ["Development", "DB Modification"].includes(t['Activity'])).reduce((acc, t) => acc + parseFloat(t['Original Estimation'] || 0), 0);
        const testEst = story.tasks.filter(t => t['Activity'] === 'Testing').reduce((acc, t) => acc + parseFloat(t['Original Estimation'] || 0), 0);
        const totalBugs = story.bugs ? story.bugs.length : 0;
        const completedBugs = story.bugs ? story.bugs.filter(b => ['Closed', 'Resolved', 'Cancel'].includes(b['State'])).length : 0;
        const testCases = story.testCases || [];
        const totalTC = testCases.length;
        const completedTC = testCases.filter(tc => ['Pass', 'Fail', 'Not Applicable'].includes(tc.state)).length;
        extraFields = `
            <div class="grid grid-cols-2 gap-2 border-t pt-2">
                <div class="text-[11px]">
                    <div class="text-gray-400 uppercase font-bold text-[9px]">Dev</div>
                    <div class="text-slate-700 truncate font-medium">${escapeHtml(story.assignedTo)}</div>
                    <div class="flex justify-between items-center mt-1">
                        <span class="text-blue-500 font-bold">${devEst}h</span>
                        <span class="text-red-500 text-[10px] font-bold">🐞${completedBugs}/${totalBugs}</span>
                    </div>
                </div>
                <div class="text-[11px] border-l pl-2">
                    <div class="text-gray-400 uppercase font-bold text-[9px]">Tester</div>
                    <div class="text-slate-700 truncate font-medium">${escapeHtml(story.tester)}</div>
                    <div class="flex justify-between items-center mt-1">
                        <span class="text-green-500 font-bold">${testEst}h</span>
                        <span class="text-indigo-500 text-[10px] font-bold">📋${completedTC}/${totalTC}</span>
                    </div>
                </div>
            </div>
        `;
    }

    const borderClass = isBacklog ? 'border-purple-200' : (isSupport ? 'border-gray-200' : 'border-gray-100');
    return `
        <div class="card relative p-3 ${borderClass} hover:border-google-blue ${customClass}">
            ${releaseDate ? `<div class="absolute top-0 right-0 bg-purple-800 text-white text-[7px] font-bold px-2 py-0.5 rounded-bl-md shadow-md z-10">📅 ${escapeHtml(releaseDate)}</div>` : ''}
            ${tags.length > 0 ? `<div class="flex flex-wrap gap-1 mb-2">${tags.map(tag => `<span class="px-1.5 py-0.5 rounded text-[8px] font-bold uppercase tracking-tighter ${(story.customTags || []).includes(tag) ? 'bg-purple-200 text-purple-700 border border-purple-300' : 'bg-slate-100 text-slate-500 border border-slate-200'}">${escapeHtml(tag.trim())}</span>`).join('')}</div>` : ''}
            ${tagDropdownHtml}
            <div class="flex justify-between items-center mb-2">
                <div onclick="ui.openStoryModal('${story.id}')" class="text-[10px] font-bold text-google-blue cursor-pointer hover:underline flex items-center gap-0.5">#${story.id} 🔍</div>
                ${commentsHtml}
            </div>
            <div onclick="ui.openStoryModal('${story.id}')" class="text-sm font-semibold text-slate-800 mb-3 line-clamp-2 cursor-pointer hover:text-google-blue transition">${escapeHtml(story.title)}</div>
            ${projectSelectHtml}
            ${extraFields}
        </div>
    `;
}

// =================================================================
// ARCHIVER
// =================================================================
const archiver = {
    async runArchive() {
        const TenDaysAgo = Date.now() - (17 * 24 * 60 * 60 * 1000);
        const logsToArchive = db.deliveryLogs.filter(log => log.timestamp < TenDaysAgo);
        const logsToKeep = db.deliveryLogs.filter(log => log.timestamp >= TenDaysAgo);
        if (logsToArchive.length === 0) {
            this.archiveClosedProjects();
            return;
        }
        try {
            let archiveData = [];
            try {
                const response = await fetch(`https://api.github.com/repos/${CONFIG.REPO_NAME}/contents/${CONFIG.ARCHIVE_PATH}`, {
                    headers: { 'Authorization': `token ${localStorage.getItem('gh_token')}` }
                });
                if (response.ok) {
                    const file = await response.json();
                    archiveData = JSON.parse(decodeURIComponent(escape(atob(file.content))));
                }
            } catch (e) { console.log("Archive file not found, creating new one."); }
            archiveData = [...archiveData, ...logsToArchive];
            await this.saveFileToGitHub(CONFIG.ARCHIVE_PATH, archiveData);
            db.deliveryLogs = logsToKeep;
            await dataProcessor.saveToGitHub();
            console.log(`${logsToArchive.length} records moved to archive.`);
        } catch (error) {
            console.error("Archive process failed:", error);
        }
        this.archiveClosedProjects();
    },
    async archiveClosedProjects() {
        const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
        const closedProjects = db.projects.filter(p => p.status === 'closed' && new Date(p.closeDate).getTime() < sevenDaysAgo);
        if (closedProjects.length > 0) {
            db.archivedProjects = db.archivedProjects || [];
            db.archivedProjects.push(...closedProjects);
            db.projects = db.projects.filter(p => !closedProjects.includes(p));
            await dataProcessor.saveToGitHub();
            console.log(`${closedProjects.length} projects archived.`);
        }
    },
    async saveFileToGitHub(path, data) {
        const token = localStorage.getItem('gh_token');
        const url = `https://api.github.com/repos/${CONFIG.REPO_NAME}/contents/${path}`;
        let sha = "";
        const res = await fetch(url, { headers: { 'Authorization': `token ${token}` } });
        if (res.ok) {
            const file = await res.json();
            sha = file.sha;
        }
        const content = btoa(unescape(encodeURIComponent(JSON.stringify(data, null, 2))));
        await fetch(url, {
            method: 'PUT',
            headers: { 'Authorization': `token ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                message: `Archive auto-update: ${new Date().toLocaleDateString()}`,
                content: content,
                sha: sha
            })
        });
    }
};

// =================================================================
// AUTH
// =================================================================
const auth = {
    async handleLogin() {
        const u = document.getElementById('username').value;
        const p = document.getElementById('password').value;
        const t = document.getElementById('gh-token').value;
        const azPat = document.getElementById('az-pat').value;
        const rem = document.getElementById('remember-me').checked;
        if (!u || !p || !t || !azPat) return alert("برجاء ملء جميع البيانات بما في ذلك Azure PAT");
        sessionStorage.setItem('az_pat', azPat);
        const loginBtn = document.querySelector("button[onclick='auth.handleLogin()']");
        const originalText = loginBtn.innerText;
        loginBtn.innerText = "جاري التحقق...";
        loginBtn.disabled = true;
        try {
            const response = await fetch(`https://api.github.com/repos/${CONFIG.REPO_NAME}/contents/${CONFIG.FILE_PATH}`, {
                headers: {
                    'Authorization': `token ${t}`,
                    'Accept': 'application/vnd.github.v3.raw'
                }
            });
            if (response.ok) {
                const remoteDb = await response.json();
                const metaRes = await fetch(`https://api.github.com/repos/${CONFIG.REPO_NAME}/contents/${CONFIG.FILE_PATH}`, {
                    headers: { 'Authorization': `token ${t}` }
                });
                const metaData = await metaRes.json();
                const userMatch = remoteDb.users.find(user => user.username === u && user.password === p);
                if (userMatch) {
                    db = remoteDb;
                    db.sha = metaData.sha;
                    if (!db.customTags) db.customTags = [];
                    if (!db.backlogStories) db.backlogStories = [];
                    if (!db.areaComments) db.areaComments = [];
                    if (!db.projects) db.projects = [];
                    if (!db.archivedProjects) db.archivedProjects = [];
                    if (!db.standupCommentsStore) db.standupCommentsStore = {};
                    
                    migrateStandupComments();
                    
                    sessionStorage.setItem('gh_token', t);
                    sessionStorage.setItem('az_pat', azPat);
                    if (rem) localStorage.setItem('saved_creds', JSON.stringify({ u, p, t, azPat }));
                    currentUser = userMatch;
                    archiver.runArchive();
                    this.startApp();
                } else {
                    alert("خطأ في اسم المستخدم أو كلمة المرور داخل ملف GitHub");
                }
            } else {
                alert("تعذر الوصول للملف. تأكد من Token ومن اسم المستودع (Repo Name)");
            }
        } catch (e) {
            console.error(e);
            alert("حدث خطأ في الاتصال بـ GitHub. تأكد من الإنترنت والـ Token");
        } finally {
            loginBtn.innerText = originalText;
            loginBtn.disabled = false;
        }
    },
    startApp() {
        document.getElementById('login-screen').classList.add('hidden');
        document.getElementById('app-container').classList.remove('hidden');
        if (currentUser.role === 'viewer') {
            const uploadBtn = document.querySelector("button[onclick*='csv-input']");
            if (uploadBtn) uploadBtn.style.display = 'none';
            const settingsNav = document.querySelector("button[onclick*='settings']");
            if (settingsNav) settingsNav.style.display = 'none';
        }
        ui.switchTab('dashboard');
        dataProcessor.sync();
    },
    logout() {
        localStorage.removeItem('saved_creds');
        location.reload();
    }
};

// =================================================================
// DATA PROCESSOR
// =================================================================
const dataProcessor = {
    _savePromise: null,
    async saveToGitHub() {
        if (this._savePromise) return this._savePromise;
        this._savePromise = this._saveToGitHubInternal().finally(() => { this._savePromise = null; });
        return this._savePromise;
    },
    async _saveToGitHubInternal() {
        const token = sessionStorage.getItem('gh_token');
        if (!token) throw new Error('GitHub token missing');
        const timestamp = Date.now();
        const metaRes = await fetch(`https://api.github.com/repos/${CONFIG.REPO_NAME}/contents/${CONFIG.FILE_PATH}?t=${timestamp}`, {
            headers: { 'Authorization': `token ${token}` }
        });
        if (!metaRes.ok) throw new Error(`Failed to get metadata: ${metaRes.status}`);
        const metaData = await metaRes.json();
        const latestSha = metaData.sha;
        const dataToSave = { ...db };
        delete dataToSave.sha;
        const jsonString = JSON.stringify(dataToSave, null, 2);
        const content = btoa(unescape(encodeURIComponent(jsonString)));
        const response = await fetch(`https://api.github.com/repos/${CONFIG.REPO_NAME}/contents/${CONFIG.FILE_PATH}`, {
            method: 'PUT',
            headers: { 'Authorization': `token ${token}` },
            body: JSON.stringify({
                message: `Update db.json [${new Date().toLocaleString()}]`,
                content: content,
                sha: latestSha
            })
        });
        if (!response.ok) {
            const error = await response.json();
            if (response.status === 409) {
                console.warn('Conflict detected, retrying...');
                return this._saveToGitHubInternal();
            }
            throw new Error(error.message);
        }
        const result = await response.json();
        db.sha = result.content.sha;
        console.log('Saved successfully with new SHA');
        return result;
    },
    async sync() {
        const token = sessionStorage.getItem('gh_token');
        try {
            const response = await fetch(`https://api.github.com/repos/${CONFIG.REPO_NAME}/contents/${CONFIG.FILE_PATH}`, {
                headers: {
                    'Authorization': `token ${token}`,
                    'Accept': 'application/vnd.github.v3.raw'
                }
            });
            if (response.ok) {
                db = await response.json();
                if (!db.customTags) db.customTags = [];
                if (!db.backlogStories) db.backlogStories = [];
                if (!db.areaComments) db.areaComments = [];
                if (!db.projects) db.projects = [];
                if (!db.archivedProjects) db.archivedProjects = [];
                if (!db.standupCommentsStore) db.standupCommentsStore = {};
                
                const metaRes = await fetch(`https://api.github.com/repos/${CONFIG.REPO_NAME}/contents/${CONFIG.FILE_PATH}`, {
                    headers: { 'Authorization': `token ${token}` }
                });
                const metaData = await metaRes.json();
                db.sha = metaData.sha;
                
                const convertDates = (story) => {
                    if (story.expectedRelease) story.expectedRelease = new Date(story.expectedRelease);
                    if (story.changedDate) story.changedDate = new Date(story.changedDate);
                    return story;
                };
                if (db.currentStories && db.currentStories.length > 0) {
                    db.currentStories = db.currentStories.map(convertDates);
                    this.calculateTimelines(db.currentStories);
                }
                if (db.backlogStories && db.backlogStories.length > 0) {
                    db.backlogStories = db.backlogStories.map(convertDates);
                }
                
                migrateStandupComments();
                pruneStandupComments();
                
                ui.renderAll();
            } else {
                console.log("File not found, creating new DB...");
                this.saveToGitHub();
            }
        } catch (e) {
            console.error("Sync Error:", e);
            ui.showToast("خطأ في المزامنة مع GitHub: " + e.message, "error");
        }
    },
    async handleCSV(event) {
        const file = event.target.files[0];
        ui.showLoader();
        try {
            const results = await new Promise((resolve, reject) => {
                Papa.parse(file, {
                    header: true,
                    skipEmptyLines: true,
                    complete: resolve,
                    error: reject
                });
            });
            await this.processRows(results.data);
            ui.showToast("تم تحديث البيانات بنجاح", "success");
        } catch (error) {
            console.error("CSV processing error:", error);
            ui.showToast("فشل معالجة الملف: " + error.message, "error");
        } finally {
            ui.hideLoader();
        }
    },
    async processRows(rows) {
        const newStories = [];
        let currentStory = null;
        rows.forEach(row => {
            const itemType = row['Work Item Type'];
            if (itemType === 'User Story' || itemType === 'CR' || itemType === 'Support log') {
                let area = row['Business Area'];
                if (area && area.trim().toLowerCase() === "integration") area = "LDM Integration";
                if (!area || area.trim() === "") {
                    const path = row['Iteration Path'] || "";
                    area = path.includes('\\') ? path.split('\\')[0] : path;
                }
                currentStory = {
                    id: row['ID'],
                    title: row['Title'],
                    type: itemType,
                    state: row['State'],
                    assignedTo: row['Assigned To'] || "Unassigned",
                    tester: row['Assigned To Tester'] || "Unassigned",
                    area: area || "General",
                    priority: parseInt(row['Business Priority']) || 999,
                    tags: row['Tags'] ? row['Tags'].split(';').filter(t => t.trim() !== "") : [],
                    expectedRelease: row['Release Expected Date'] ? new Date(row['Release Expected Date']) : null,
                    branch: row['Branch'] || "N/A",
                    customer: row['Customer'] || "General",
                    changedDate: row['Changed Date'] ? new Date(row['Changed Date']) : null,
                    tasks: [],
                    bugs: [],
                    testCases: [],
                    reviews: [],
                    calc: {},
                    customTags: [],
                    iterationPath: row['Iteration Path'] || "",
                    devActualTime: parseFloat(row['TimeSheet_DevActualTime']) || 0,
                    testActualTime: parseFloat(row['TimeSheet_TestingActualTime']) || 0,
                    isBacklog: false,
                    linkedProjectId: null
                };
                const existingStory = db.currentStories.find(s => s.id == currentStory.id);
                if (existingStory) {
                    if (existingStory.customTags) currentStory.customTags = existingStory.customTags;
                    if (existingStory.linkedProjectId) currentStory.linkedProjectId = existingStory.linkedProjectId;
                }
                newStories.push(currentStory);
            } else if (row['Work Item Type'] === 'Task' && currentStory) {
                currentStory.tasks.push(row);
            } else if (row['Work Item Type'] === 'Bug' && currentStory) {
                currentStory.bugs.push(row);
            } else if (row['Work Item Type'] === 'Test Case' && currentStory) {
                currentStory.testCases.push({
                    id: row['ID'],
                    state: row['State']
                });
            } else if (row['Work Item Type'] === 'Review' && currentStory) {
                currentStory.reviews.push({
                    id: row['ID'],
                    title: row['Title'],
                    state: row['State'],
                    assignedTo: row['Assigned To'] || "Unassigned"
                });
            }
        });
        this.calculateTimelines(newStories);
        db.currentStories = newStories;
        
        pruneStandupComments();
        await this.saveToGitHub();
    },
    async processBacklogRows(rows) {
        console.log(`Processing ${rows.length} backlog rows`);
        const backlogStories = rows.map(row => {
            const state = row['State'] || "";
            if (!["New", "Approved"].includes(state)) return null;
            const area = row['Business Area'] || "General";
            return {
                id: row['ID'],
                title: row['Title'] || "Untitled",
                type: 'User Story',
                state: state,
                assignedTo: row['Assigned To'] || "Unassigned",
                tester: "Unassigned",
                area: area,
                priority: parseInt(row['Business Priority']) || 999,
                tags: row['Tags'] ? row['Tags'].split(';').filter(t => t.trim() !== "") : [],
                expectedRelease: row['Release Expected Date'] ? new Date(row['Release Expected Date']) : null,
                branch: "N/A",
                customer: "General",
                changedDate: row['Changed Date'] ? new Date(row['Changed Date']) : null,
                tasks: [],
                bugs: [],
                testCases: [],
                reviews: [],
                calc: {},
                customTags: [],
                iterationPath: row['Iteration Path'] || "",
                devActualTime: 0,
                testActualTime: 0,
                isBacklog: true,
                linkedProjectId: null
            };
        }).filter(s => s !== null);
        db.backlogStories = backlogStories;
        
        pruneStandupComments();
        await this.saveToGitHub();
        console.log(`Saved ${backlogStories.length} backlog stories`);
        ui.renderAll();
    },
    calculateTimelines(stories) {
        stories.sort((a, b) => (a.priority || 999) - (b.priority || 999));
        const staffAvailability = {};
        stories.forEach(story => {
            const devTasks = story.tasks.filter(t => ["Development", "DB Modification"].includes(t['Activity']));
            const devHours = devTasks.reduce((acc, t) => {
                const effort = t['State'] === 'To Be Reviewed' ? 0 : parseFloat(t['Original Estimation'] || 0);
                return acc + effort;
            }, 0);
            let devStart = null;
            const activatedDates = devTasks.map(t => t['Activated Date']).filter(d => d).sort();
            if (activatedDates.length > 0) devStart = new Date(activatedDates[0]);
            if (!devStart) {
                story.calc.error = "بانتظار تفعيل التاسكات (No Activated Tasks)";
                story.calc.devEnd = "TBD";
                story.calc.testEnd = "---";
                story.calc.finalEnd = "---";
                return;
            }
            let devActualStart = new Date(Math.max(devStart, staffAvailability[story.assignedTo] || devStart));
            story.calc.devEnd = dateEngine.addWorkingHours(devActualStart, devHours, story.assignedTo);
            staffAvailability[story.assignedTo] = new Date(story.calc.devEnd);
            const testTasks = story.tasks.filter(t => t['Activity'] === 'Testing');
            if (testTasks.length === 0) {
                story.calc.testEnd = "Waiting for Data";
                story.calc.finalEnd = "Waiting for Data";
            } else {
                const prepTasks = testTasks.filter(t => t['Title'].toLowerCase().includes('prep') || t['Activity'] === 'Preparation');
                const actualTestTasks = testTasks.filter(t => !prepTasks.includes(t));
                const prepHours = prepTasks.reduce((acc, t) => acc + (t['State'] === 'To Be Reviewed' ? 0 : parseFloat(t['Original Estimation'] || 0)), 0);
                const actualTestHours = actualTestTasks.reduce((acc, t) => acc + (t['State'] === 'To Be Reviewed' ? 0 : parseFloat(t['Original Estimation'] || 0)), 0);
                let prepStart = null;
                const prepActivatedDates = prepTasks.map(t => t['Activated Date']).filter(d => d).sort();
                if (prepActivatedDates.length > 0) prepStart = new Date(prepActivatedDates[0]);
                let testActualStart;
                let readyForTestDate = new Date(story.calc.devEnd);
                readyForTestDate.setDate(readyForTestDate.getDate() + 1);
                readyForTestDate.setHours(9, 0, 0, 0);
                testActualStart = new Date(Math.max(readyForTestDate, staffAvailability[story.tester] || readyForTestDate));
                if (prepStart && prepStart < story.calc.devEnd) {
                    story.calc.testEnd = dateEngine.addWorkingHours(testActualStart, actualTestHours, story.tester);
                } else {
                    const totalTestHours = prepHours + actualTestHours;
                    story.calc.testEnd = dateEngine.addWorkingHours(testActualStart, totalTestHours, story.tester);
                }
                staffAvailability[story.tester] = new Date(story.calc.testEnd);
                story.calc.finalEnd = new Date(story.calc.testEnd);
            }
            let finalDeliveryDate = new Date(story.calc.testEnd);
            if (story.bugs && story.bugs.length > 0) {
                story.bugs.forEach(bug => {
                    const bugEffort = parseFloat(bug['Original Estimation'] || 0);
                    const bugActivatedDate = bug['Activated Date'] ? new Date(bug['Activated Date']) : null;
                    if (bugActivatedDate && bugEffort > 0) {
                        const bugFinish = dateEngine.addWorkingHours(bugActivatedDate, bugEffort, story.assignedTo);
                        if (bugFinish > finalDeliveryDate) finalDeliveryDate = bugFinish;
                        if (bugFinish > staffAvailability[story.assignedTo]) staffAvailability[story.assignedTo] = new Date(bugFinish);
                    }
                });
            }
            story.calc.finalEnd = finalDeliveryDate;
        });
        currentData = stories;
        ui.renderAll();
    }
};

// =================================================================
// DATE ENGINE
// =================================================================
const dateEngine = {
    isWorkDay(date, person) {
        const day = date.getDay();
        const dateStr = date.toISOString().split('T')[0];
        if (CONFIG.WEEKEND.includes(day)) return false;
        if (db.holidays && db.holidays.includes(dateStr)) return false;
        if (db.vacations.some(v => v.name === person && v.date === dateStr)) return false;
        return true;
    },
    countVacationDaysUntilNow(startDate, personName) {
        if (!startDate) return 0;
        const start = new Date(startDate);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        start.setHours(0, 0, 0, 0);
        if (start > today) return 0;
        let count = 0;
        let current = new Date(start);
        while (current <= today) {
            if (!this.isWorkDay(current, personName)) count++;
            current.setDate(current.getDate() + 1);
        }
        return count;
    },
    countVacationDays(startDate, endDate, person) {
        if (!(startDate instanceof Date) || !(endDate instanceof Date) || isNaN(startDate) || isNaN(endDate)) return 0;
        let count = 0;
        let current = new Date(startDate);
        while (current <= endDate) {
            if (!this.isWorkDay(current, person)) count++;
            current.setDate(current.getDate() + 1);
        }
        return count;
    },
    addWorkingHours(startDate, hours, person) {
        let result = new Date(startDate);
        let remainingHours = hours;
        while (!this.isWorkDay(result, person)) {
            result.setDate(result.getDate() + 1);
            result.setHours(CONFIG.START_HOUR, 0, 0, 0);
        }
        while (remainingHours > 0) {
            if (this.isWorkDay(result, person)) {
                let currentHour = result.getHours();
                if (currentHour >= CONFIG.START_HOUR && currentHour < CONFIG.END_HOUR) {
                    remainingHours -= (CONFIG.WORKING_HOURS / (CONFIG.END_HOUR - CONFIG.START_HOUR));
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

// =================================================================
// AREA COMMENT MANAGER
// =================================================================
const areaCommentManager = {
    addComment(area, text) {
        if (!area || !text || !text.trim()) return;
        db.areaComments.push({
            area: area,
            text: text.trim(),
            timestamp: new Date().toLocaleString('ar-EG', { hour12: false })
        });
        dataProcessor.saveToGitHub().then(() => {
            ui.renderKanban();
        }).catch(err => {
            console.error('Failed to save area comment:', err);
            ui.showToast('فشل حفظ التعليق: ' + err.message, 'error');
        });
    },
    openCommentsPopup() {
        const modal = document.getElementById('comments-popup');
        if (!modal) return;
        const filterSelect = document.getElementById('kanban-ba-filter');
        let selectedAreas = Array.from(filterSelect.selectedOptions).map(opt => opt.value);
        if (selectedAreas.length === 0) {
            const allStories = [...currentData.filter(s => !isBacklogStory(s) && isRegularStory(s)), ...db.backlogStories];
            const areas = [...new Set(allStories.map(s => s.area || "General"))].sort();
            this.renderCommentsPopup(areas);
        } else {
            this.renderCommentsPopup(selectedAreas);
        }
        modal.classList.remove('hidden');
        document.body.style.overflow = 'hidden';
    },
    closeCommentsPopup() {
        const modal = document.getElementById('comments-popup');
        if (modal) modal.classList.add('hidden');
        document.body.style.overflow = 'auto';
    },
    renderCommentsPopup(areas) {
        const content = document.getElementById('comments-popup-content');
        if (!content) return;
        if (!areas || areas.length === 0) {
            content.innerHTML = `<div class="text-center py-10 text-gray-400">لا توجد مناطق محددة.</div>`;
            return;
        }
        let html = '';
        areas.forEach(area => {
            const comments = db.areaComments.filter(c => c.area === area);
            html += `
                <div class="mb-6 border-b border-gray-100 pb-4 last:border-0">
                    <div class="flex justify-between items-center mb-3">
                        <h4 class="font-bold text-indigo-700 text-sm">📍 ${escapeHtml(area)}</h4>
                        <span class="text-xs text-gray-400">${comments.length} تعليق</span>
                    </div>
                    <div class="space-y-2 max-h-60 overflow-y-auto pr-2">
                        ${comments.length === 0 ? '<p class="text-gray-400 text-xs italic">لا توجد تعليقات في هذه المنطقة.</p>' : ''}
                        ${comments.map((c, index) => `
                            <div class="flex justify-between items-start bg-gray-50 p-3 rounded-lg border border-gray-100 comment-item">
                                <div class="flex-1">
                                    <p class="text-sm text-slate-700" style="direction: rtl; text-align: right;">${escapeHtml(c.text)}</p>
                                    <p class="text-[10px] text-gray-400 mt-1">${escapeHtml(c.timestamp)}</p>
                                </div>
                                <button onclick="areaCommentManager.deleteComment('${encodeURIComponent(area)}', ${index})" class="text-red-400 hover:text-red-600 text-sm font-bold ml-2" title="حذف التعليق">✕</button>
                            </div>
                        `).join('')}
                    </div>
                    <div class="mt-3 flex gap-2">
                        <textarea id="area-comment-${area.replace(/\s/g, '')}" 
                                  placeholder="اكتب تعليق عام عن المنطقة..." 
                                  class="form-input flex-1 resize-none"
                                  rows="1"
                                  style="direction: rtl; text-align: right;"></textarea>
                        <button onclick="areaCommentManager.addCommentFromPopup('${encodeURIComponent(area)}')" 
                                class="btn btn-primary whitespace-nowrap">
                            إضافة
                        </button>
                    </div>
                </div>
            `;
        });
        content.innerHTML = html;
    },
    addCommentFromPopup(area) {
        const textarea = document.getElementById(`area-comment-${area.replace(/\s/g, '')}`);
        if (!textarea) return;
        const text = textarea.value.trim();
        if (!text) return;
        this.addComment(area, text);
        textarea.value = '';
        this.openCommentsPopup();
    },
    deleteComment(area, index) {
        if (!confirm('هل تريد حذف هذا التعليق؟')) return;
        const comments = db.areaComments.filter(c => c.area === area);
        if (comments[index]) {
            const commentToDelete = comments[index];
            const globalIndex = db.areaComments.indexOf(commentToDelete);
            if (globalIndex > -1) {
                db.areaComments.splice(globalIndex, 1);
                dataProcessor.saveToGitHub().then(() => {
                    this.openCommentsPopup();
                    ui.renderKanban();
                }).catch(err => {
                    console.error('Failed to delete comment:', err);
                    ui.showToast('فشل حذف التعليق: ' + err.message, 'error');
                });
            }
        }
    },
    renderAreaComments(areas) {
        return '';
    }
};

// =================================================================
// PROJECT MANAGER
// =================================================================
const projectManager = {
    generateId() {
        return Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
    },
    addProject() {
        const name = document.getElementById('project-name').value.trim();
        const team = document.getElementById('project-team').value.trim();
        const dueDate = document.getElementById('project-due-date').value;
        if (!name || !team || !dueDate) return alert('Please fill all fields');
        const newProject = {
            id: this.generateId(),
            name,
            team,
            dueDate,
            status: 'active',
            holdReason: '',
            holdEndDate: '',
            closeDate: '',
            tasks: [],
            linkedStoryIds: []
        };
        executeWithSave(
            () => { db.projects.push(newProject); },
            'تم إضافة المشروع بنجاح',
            'فشل إضافة المشروع',
            () => { ui.renderAll(); ui.renderProjectsTab(); ui.renderSettings(); }
        );
    },
    deleteProject(projectId) {
        if (!confirm('Are you sure you want to delete this project?')) return;
        executeWithSave(
            () => {
                db.projects = db.projects.filter(p => p.id !== projectId);
                db.currentStories.forEach(s => { if (s.linkedProjectId === projectId) delete s.linkedProjectId; });
                db.backlogStories.forEach(s => { if (s.linkedProjectId === projectId) delete s.linkedProjectId; });
            },
            'تم حذف المشروع',
            'فشل حذف المشروع',
            () => { ui.renderAll(); ui.renderProjectsTab(); ui.renderSettings(); }
        );
    },
    updateProjectDueDate(projectId, newDate) {
        const project = this.getProjectById(projectId);
        if (!project) return;
        if (!newDate) return ui.showToast('الرجاء إدخال تاريخ صحيح', 'error');
        executeWithSave(
            () => { project.dueDate = newDate; },
            'تم تحديث تاريخ المشروع',
            'فشل تحديث التاريخ',
            () => { ui.renderProjectsTab(); ui.openProjectDetails(projectId); }
        );
    },
    updateTaskDueDate(projectId, taskId, newDate) {
        const project = this.getProjectById(projectId);
        if (!project) return;
        const task = project.tasks.find(t => t.id === taskId);
        if (!task) return;
        if (!newDate) return ui.showToast('الرجاء إدخال تاريخ صحيح', 'error');
        executeWithSave(
            () => { task.dueDate = newDate; },
            'تم تحديث تاريخ المهمة',
            'فشل تحديث التاريخ',
            () => { ui.renderProjectsTab(); ui.openProjectDetails(projectId); }
        );
    },
    getProjectById(id) {
        return db.projects.find(p => p.id === id);
    },
    linkStoryToProject(storyId, projectId) {
        let story = db.currentStories.find(s => (s.id || s.ID) == storyId);
        if (!story) story = db.backlogStories.find(s => (s.id || s.ID) == storyId);
        if (!story) return;
        if (story.linkedProjectId) {
            const oldProject = this.getProjectById(story.linkedProjectId);
            if (oldProject) {
                oldProject.linkedStoryIds = oldProject.linkedStoryIds.filter(id => id != storyId);
            }
        }
        story.linkedProjectId = projectId;
        const project = this.getProjectById(projectId);
        if (project && !project.linkedStoryIds.includes(storyId.toString())) {
            project.linkedStoryIds.push(storyId.toString());
        }
        executeWithSave(
            () => {},
            'تم ربط القصة بالمشروع',
            'فشل الربط',
            () => ui.renderAll()
        );
    },
    unlinkStoryFromProject(storyId) {
        let story = db.currentStories.find(s => (s.id || s.ID) == storyId);
        if (!story) story = db.backlogStories.find(s => (s.id || s.ID) == storyId);
        if (!story || !story.linkedProjectId) return;
        const project = this.getProjectById(story.linkedProjectId);
        if (project) {
            project.linkedStoryIds = project.linkedStoryIds.filter(id => id != storyId);
        }
        delete story.linkedProjectId;
        executeWithSave(
            () => {},
            'تم فك الربط',
            'فشل فك الربط',
            () => ui.renderAll()
        );
    },
    holdProject(projectId) {
        const reason = prompt('Enter reason for holding the project:');
        if (reason === null) return;
        const endDate = prompt('Expected end date of hold (YYYY-MM-DD):');
        if (endDate === null) return;
        const project = this.getProjectById(projectId);
        if (!project) return;
        executeWithSave(
            () => {
                project.status = 'hold';
                project.holdReason = reason;
                project.holdEndDate = endDate;
            },
            'تم وضع المشروع على Hold',
            'فشل وضع المشروع على Hold',
            () => { ui.renderAll(); ui.renderProjectsTab(); }
        );
    },
    closeProject(projectId) {
        if (!confirm('Are you sure you want to close this project? It will be archived after 7 days.')) return;
        const project = this.getProjectById(projectId);
        if (!project) return;
        executeWithSave(
            () => {
                project.status = 'closed';
                project.closeDate = new Date().toISOString().split('T')[0];
            },
            'تم إغلاق المشروع',
            'فشل إغلاق المشروع',
            () => { ui.renderAll(); ui.renderProjectsTab(); }
        );
    },
    addTask(projectId, title, dueDate) {
        if (!title || !dueDate) return ui.showToast('Please fill task title and due date', 'error');
        const project = this.getProjectById(projectId);
        if (!project) return;
        const newTask = {
            id: this.generateId(),
            title,
            dueDate,
            status: 'todo',
            comments: []
        };
        executeWithSave(
            () => { project.tasks.push(newTask); },
            'تم إضافة المهمة',
            'فشل إضافة المهمة',
            () => ui.renderProjectDetailsModal(projectId)
        );
    },
    deleteTask(projectId, taskId) {
        if (!confirm('Delete this task?')) return;
        const project = this.getProjectById(projectId);
        if (!project) return;
        executeWithSave(
            () => { project.tasks = project.tasks.filter(t => t.id !== taskId); },
            'تم حذف المهمة',
            'فشل حذف المهمة',
            () => ui.renderProjectDetailsModal(projectId)
        );
    },
    updateTaskStatus(projectId, taskId, newStatus) {
        const project = this.getProjectById(projectId);
        if (!project) return;
        const task = project.tasks.find(t => t.id === taskId);
        if (!task) return;
        executeWithSave(
            () => { task.status = newStatus; },
            'تم تحديث حالة المهمة',
            'فشل تحديث الحالة',
            () => ui.renderProjectDetailsModal(projectId)
        );
    },
    addTaskComment(projectId, taskId, commentText) {
        if (!commentText.trim()) return;
        const project = this.getProjectById(projectId);
        if (!project) return;
        const task = project.tasks.find(t => t.id === taskId);
        if (!task) return;
        executeWithSave(
            () => { task.comments.push({ text: commentText.trim(), timestamp: new Date().toLocaleString('ar-EG', { hour12: false }) }); },
            'تم إضافة التعليق',
            'فشل إضافة التعليق',
            () => ui.renderProjectDetailsModal(projectId)
        );
    },
    deleteTaskComment(projectId, taskId, commentIndex) {
        if (!confirm('Delete this comment?')) return;
        const project = this.getProjectById(projectId);
        if (!project) return;
        const task = project.tasks.find(t => t.id === taskId);
        if (!task) return;
        executeWithSave(
            () => { task.comments.splice(commentIndex, 1); },
            'تم حذف التعليق',
            'فشل حذف التعليق',
            () => ui.renderProjectDetailsModal(projectId)
        );
    }
};

// =================================================================
// UI RENDERING (UPDATED WITH NEW CLASSES & LIGHT BACKGROUNDS)
// =================================================================
const ui = {
    showLoader() {
        let loader = document.getElementById('project-loader');
        if (!loader) {
            loader = document.createElement('div');
            loader.id = 'project-loader';
            loader.className = 'fixed inset-0 bg-black/30 flex items-center justify-center z-[3000] hidden';
            loader.innerHTML = `
                <div class="bg-white p-6 rounded-xl shadow-2xl flex items-center gap-4">
                    <div class="w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin"></div>
                    <span class="font-bold text-slate-700">صلي ع النبي ...</span>
                </div>
            `;
            document.body.appendChild(loader);
        }
        loader.classList.remove('hidden');
    },
    hideLoader() {
        const loader = document.getElementById('project-loader');
        if (loader) loader.classList.add('hidden');
    },
    showToast(message, type = 'success') {
        const existing = document.querySelector('.toast-message');
        if (existing) existing.remove();
        const toast = document.createElement('div');
        toast.className = `toast-message fixed top-4 right-4 z-[5000] px-6 py-3 rounded-xl shadow-2xl text-white font-bold text-sm transition-all duration-500 ${type === 'success' ? 'bg-google-green' : 'bg-google-red'}`;
        toast.innerText = message;
        document.body.appendChild(toast);
        setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 500); }, 3000);
    },
    switchTab(tabId) {
        document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
        document.getElementById(`tab-${tabId}`).classList.add('active');
        this.renderAll();
        if (tabId === 'projects') this.renderProjectsTab();
    },
    renderAll() {
        this.renderDashboard();
        this.renderActiveCards();
        this.renderDelivery();
        this.renderSettings();
        this.renderWorkload();
        if (currentUser && currentUser.role === 'viewer') {
            const uploadBtn = document.querySelector("button[onclick*='csv-input']");
            if (uploadBtn) uploadBtn.style.display = 'none';
            const settingsNav = document.querySelector("button[onclick*='settings']");
            if (settingsNav) settingsNav.style.display = 'none';
        }
        const activeTab = document.querySelector('.tab-content.active');
        if (!activeTab) return;
        switch (activeTab.id) {
            case 'tab-daily-activity': this.renderDailyActivity(); break;
            case 'tab-inactive-stories': this.renderInactiveStories(); break;
            case 'tab-kanban': this.renderKanban(); break;
            case 'tab-auditor': this.renderAuditorChecklist(); break;
            case 'tab-support-kanban': this.renderSupportKanban(); break;
            case 'tab-projects': this.renderProjectsTab(); break;
            default: break;
        }
    },
    renderDashboard() {
        const container = document.getElementById('dashboard-container');
        if (!container) return;
        const activeStories = currentData.filter(s => s.state !== 'Tested' && s.state !== 'Closed' && !isBacklogStory(s) && isRegularStory(s));
        const activeDevsSet = new Set();
        const activeTestersSet = new Set();
        activeStories.forEach(s => {
            if (s.assignedTo && s.assignedTo !== "Unassigned") activeDevsSet.add(s.assignedTo);
            if (s.tester && s.tester !== "Unassigned") activeTestersSet.add(s.tester);
        });
        const freeDevs = this.getFreeStaff('dev');
        const freeTesters = this.getFreeStaff('tester');
        // UPDATED: Light backgrounds with dark text
        const staffStatsHtml = `
            <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                <div onclick="ui.showStaffDetails('dev', 'active')" class="bg-gradient-to-br from-blue-100 to-blue-200 p-4 rounded-2xl shadow-lg text-slate-800 cursor-pointer hover:scale-105 transition-transform">
                    <div class="text-[10px] opacity-80 font-bold uppercase tracking-wider">Active Developers</div>
                    <div class="text-4xl font-black mt-1">${activeDevsSet.size}</div>
                    <div class="text-[10px] mt-2 bg-white/50 inline-block px-2 py-0.5 rounded">Click for details</div>
                </div>
                <div onclick="ui.showStaffDetails('tester', 'active')" class="bg-gradient-to-br from-green-100 to-green-200 p-4 rounded-2xl shadow-lg text-slate-800 cursor-pointer hover:scale-105 transition-transform">
                    <div class="text-[10px] opacity-80 font-bold uppercase tracking-wider">Active Testers</div>
                    <div class="text-4xl font-black mt-1">${activeTestersSet.size}</div>
                    <div class="text-[10px] mt-2 bg-white/50 inline-block px-2 py-0.5 rounded">Click for details</div>
                </div>
                <div onclick="ui.showStaffDetails('dev', 'free')" class="bg-gradient-to-br from-slate-100 to-slate-200 p-4 rounded-2xl shadow-lg text-slate-800 cursor-pointer hover:scale-105 transition-transform">
                    <div class="text-[10px] opacity-80 font-bold uppercase tracking-wider">Free Developers</div>
                    <div class="text-4xl font-black mt-1">${freeDevs.length}</div>
                    <div class="text-[10px] mt-2 bg-white/50 inline-block px-2 py-0.5 rounded">Click for details</div>
                </div>
                <div onclick="ui.showStaffDetails('tester', 'free')" class="bg-gradient-to-br from-purple-100 to-purple-200 p-4 rounded-2xl shadow-lg text-slate-800 cursor-pointer hover:scale-105 transition-transform">
                    <div class="text-[10px] opacity-80 font-bold uppercase tracking-wider">Free Testers</div>
                    <div class="text-4xl font-black mt-1">${freeTesters.length}</div>
                    <div class="text-[10px] mt-2 bg-white/50 inline-block px-2 py-0.5 rounded">Click for details</div>
                </div>
            </div>
        `;
        const nonBacklogData = currentData.filter(s => !isBacklogStory(s) && isRegularStory(s));
        const areaStateMap = {};
        const allStates = new Set();
        nonBacklogData.forEach(s => {
            const area = s.area || 'General';
            const state = s.state || 'Unknown';
            allStates.add(state);
            if (!areaStateMap[area]) areaStateMap[area] = {};
            if (!areaStateMap[area][state]) areaStateMap[area][state] = 0;
            areaStateMap[area][state]++;
        });
        const sortedStates = Array.from(allStates).sort();
        let areaStatsHtml = `
            <div class="card p-6">
                <h3 class="font-bold text-slate-700 mb-4 flex items-center gap-2">📊 Business Area Stats (By State)</h3>
                <div class="overflow-x-auto">
                    <table class="w-full text-sm">
                        <thead><tr class="bg-gray-50 border-b">
                            <th class="text-left p-2 font-bold text-gray-600">Business Area</th>
                            ${sortedStates.map(state => `<th class="text-center p-2 font-bold text-gray-600">${escapeHtml(state)}</th>`).join('')}
                            <th class="text-center p-2 font-bold text-google-blue">Total</th>
                        </tr></thead>
                        <tbody>
        `;
        let grandTotal = 0;
        const sortedAreas = Object.keys(areaStateMap).sort();
        sortedAreas.forEach(area => {
            const statesData = areaStateMap[area];
            let rowTotal = 0;
            let rowCells = sortedStates.map(state => {
                const count = statesData[state] || 0;
                rowTotal += count;
                return `<td class="text-center p-2 border-t">${count}</td>`;
            }).join('');
            grandTotal += rowTotal;
            areaStatsHtml += `<tr class="border-b hover:bg-gray-50">
                <td class="p-2 font-medium text-slate-700">${escapeHtml(area)}</td>
                ${rowCells}
                <td class="text-center p-2 border-t font-bold text-google-blue">${rowTotal}</td>
            </tr>`;
        });
        areaStatsHtml += `
                    <tr class="bg-gray-100 font-bold">
                        <td class="p-2 text-slate-800">Grand Total</td>
                        ${sortedStates.map(state => {
                            let total = 0;
                            Object.values(areaStateMap).forEach(areaData => { total += areaData[state] || 0; });
                            return `<td class="text-center p-2">${total}</td>`;
                        }).join('')}
                        <td class="text-center p-2 text-google-blue">${grandTotal}</td>
                    </tr>
                </tbody></table></div>`;
        const activeNonBacklog = nonBacklogData.filter(s => s.state !== 'Tested' && s.state !== 'Closed');
        const branchMap = {};
        activeNonBacklog.forEach(s => {
            const branch = s.branch || 'N/A';
            branchMap[branch] = (branchMap[branch] || 0) + 1;
        });
        const sortedBranches = Object.entries(branchMap).sort((a, b) => b[1] - a[1]);
        let branchStatsHtml = `
            <div class="card p-6">
                <h3 class="font-bold text-slate-700 mb-4 flex items-center gap-2">🌿 Active Stories by Branch</h3>
                <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        `;
        sortedBranches.forEach(([branch, count]) => {
            branchStatsHtml += `
                <div class="bg-google-blue-light p-3 rounded-lg border border-google-blue/20 text-center cursor-pointer hover:bg-google-blue/20 transition" onclick="ui.showBranchModal('${encodeURIComponent(branch)}')">
                    <div class="text-xs font-bold text-google-blue truncate" title="${escapeHtml(branch)}">${escapeHtml(branch)}</div>
                    <div class="text-2xl font-black text-google-blue">${count}</div>
                </div>
            `;
        });
        branchStatsHtml += `</div><div class="mt-2 text-xs text-gray-400">Total Active Stories: ${activeNonBacklog.length}</div></div>`;

        const customerMap = {};
        activeNonBacklog.forEach(s => {
            const customer = s.customer || 'General';
            customerMap[customer] = (customerMap[customer] || 0) + 1;
        });
        const sortedCustomers = Object.entries(customerMap).sort((a, b) => b[1] - a[1]);
        let customerStatsHtml = `
            <div class="card p-6">
                <h3 class="font-bold text-slate-700 mb-4 flex items-center gap-2">👥 Active Stories by Customer</h3>
                <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        `;
        sortedCustomers.forEach(([customer, count]) => {
            customerStatsHtml += `
                <div class="bg-google-green-light p-3 rounded-lg border border-google-green/20 text-center cursor-pointer hover:bg-google-green/20 transition" onclick="ui.showCustomerModal('${encodeURIComponent(customer)}')">
                    <div class="text-xs font-bold text-google-green truncate" title="${escapeHtml(customer)}">${escapeHtml(customer)}</div>
                    <div class="text-2xl font-black text-google-green">${count}</div>
                </div>
            `;
        });
        customerStatsHtml += `</div><div class="mt-2 text-xs text-gray-400">Total Active Stories: ${activeNonBacklog.length}</div></div>`;

        const regularCurrent = currentData.filter(isRegularStory);
        const allStoriesForRoadmap = [...regularCurrent, ...db.backlogStories];
        const roadmapHtml = this.renderClientRoadmap(allStoriesForRoadmap);

        container.innerHTML = `
            ${staffStatsHtml}
            ${areaStatsHtml}
            <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
                ${branchStatsHtml}
                ${customerStatsHtml}
            </div>
            <div class="mt-6">${roadmapHtml}</div>
        `;
    },
    renderClientRoadmap(stories = []) {
        const today = new Date();
        const twoMonthsLater = new Date();
        twoMonthsLater.setMonth(twoMonthsLater.getMonth() + CONFIG.BACKLOG_MONTHS);
        const safeStories = stories.map(s => {
            if (s.expectedRelease && typeof s.expectedRelease === 'string') {
                s.expectedRelease = new Date(s.expectedRelease);
            }
            return s;
        });
        const upcomingDeliveries = safeStories.filter(s => {
            if (!s.expectedRelease || !(s.expectedRelease instanceof Date)) return false;
            const isNotDone = s.state !== 'Tested' && s.state !== 'Closed';
            const isWithinRange = s.expectedRelease >= today && s.expectedRelease <= twoMonthsLater;
            return isNotDone && isWithinRange;
        });
        upcomingDeliveries.sort((a, b) => a.expectedRelease - b.expectedRelease);
        let html = `
            <div class="card p-6">
                <h3 class="font-bold text-google-blue mb-4 flex items-center gap-2">
                    🚀 Client Delivery Roadmap (Next ${CONFIG.BACKLOG_MONTHS} Months)
                    <span class="text-xs font-normal text-gray-400 ml-2">(${upcomingDeliveries.length} items)</span>
                </h3>
                <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        `;
        if (upcomingDeliveries.length === 0) {
            html += `<div class="col-span-full text-center py-8 text-gray-400">No client deliveries expected in the next ${CONFIG.BACKLOG_MONTHS} months.</div>`;
        } else {
            html += upcomingDeliveries.map(s => {
                const diffTime = Math.abs(s.expectedRelease - today);
                const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                let urgencyClass = "border-google-blue/30 bg-white";
                if (diffDays <= 7) urgencyClass = "border-google-yellow bg-google-yellow-light";
                if (diffDays <= 3) urgencyClass = "border-google-red bg-google-red-light";
                const isBacklog = isBacklogStory(s) ? '📋 ' : '';
                return `
                    <div class="card p-4 border-2 ${urgencyClass} ${isBacklogStory(s) ? 'border-dashed' : ''}">
                        <div class="flex justify-between items-start mb-2">
                            <span class="text-[10px] font-bold text-google-blue bg-google-blue-light px-2 py-0.5 rounded">In ${diffDays} Days</span>
                            <div class="flex items-center gap-2">
                                <span class="text-[10px] font-bold text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded">P${escapeHtml(s.priority || '?')}</span>
                                <span class="text-[10px] text-gray-400">#${s.id}</span>
                            </div>
                        </div>
                        <div class="text-sm font-bold text-slate-800 truncate" title="${escapeHtml(s.title)}">${isBacklog}${escapeHtml(s.title)}</div>
                        <div class="text-[11px] text-gray-500 mt-1">Area: ${escapeHtml(s.area)}</div>
                        ${isBacklogStory(s) ? '<div class="text-[10px] text-purple-600 font-bold mt-1">📋 Backlog</div>' : ''}
                        <div class="mt-3 flex justify-between items-center">
                            <div class="text-[10px] font-bold uppercase text-gray-400">Release:</div>
                            <div class="text-xs font-bold text-slate-700">${s.expectedRelease.toLocaleDateString('en-GB')}</div>
                        </div>
                        <div class="mt-2 h-1 w-full bg-gray-100 rounded-full overflow-hidden">
                            <div class="h-full ${isBacklogStory(s) ? 'bg-purple-400' : 'bg-google-blue'}" style="width: ${s.state === 'Resolved' ? '80%' : '40%'}"></div>
                        </div>
                    </div>
                `;
            }).join('');
        }
        html += `</div></div>`;
        return html;
    },
    getFreeStaff(role) {
        const allStories = currentData.filter(s => !isBacklogStory(s));
        const allStaff = new Set();
        allStories.forEach(s => {
            if (role === 'dev' && s.assignedTo && s.assignedTo !== "Unassigned") allStaff.add(s.assignedTo);
            else if (role === 'tester' && s.tester && s.tester !== "Unassigned") allStaff.add(s.tester);
        });
        const busyStaff = new Set();
        allStories.forEach(s => {
            const activeTasks = (s.tasks || []).filter(t =>
                t['State'] !== 'To Be Reviewed' && t['State'] !== 'Closed' &&
                parseFloat(t['Original Estimation'] || 0) > 0
            );
            activeTasks.forEach(t => {
                const worker = (t['Activity'] === 'Testing') ? s.tester : s.assignedTo;
                if (worker && worker !== "Unassigned") busyStaff.add(worker);
            });
        });
        allStories.forEach(s => {
            if (s.type === 'Support log' && s.state !== 'Tested' && s.state !== 'Closed') {
                if (role === 'dev' && s.assignedTo && s.assignedTo !== "Unassigned") busyStaff.add(s.assignedTo);
                if (role === 'tester' && s.tester && s.tester !== "Unassigned") busyStaff.add(s.tester);
            }
        });
        allStories.forEach(s => {
            if (s.bugs && s.bugs.length > 0) {
                s.bugs.forEach(bug => {
                    if (['New', 'Active'].includes(bug['State'])) {
                        const worker = bug['Assigned To'];
                        if (worker && worker !== "Unassigned") busyStaff.add(worker);
                    }
                });
            }
        });
        return Array.from(allStaff).filter(name => !busyStaff.has(name));
    },
    showStaffModal(title, list, showStoryCount = true) {
        const modal = document.getElementById('story-modal');
        const titleEl = document.getElementById('modal-title');
        const body = document.getElementById('modal-body');
        titleEl.innerText = title;
        if (!list || list.length === 0) {
            body.innerHTML = `<div class="text-center py-10 text-gray-400">لا يوجد موظفون في هذه الفئة.</div>`;
        } else {
            let html = `<div class="space-y-3">`;
            const regularNonBacklog = currentData.filter(s => !isBacklogStory(s) && isRegularStory(s));
            list.forEach(name => {
                if (showStoryCount) {
                    let count = 0;
                    if (title.includes('Developers')) {
                        count = regularNonBacklog.filter(s => s.assignedTo === name && s.state !== 'Tested' && s.state !== 'Closed').length;
                    } else if (title.includes('Testers')) {
                        count = regularNonBacklog.filter(s => s.tester === name && s.state !== 'Tested' && s.state !== 'Closed').length;
                    }
                    html += `
                        <div class="flex justify-between items-center bg-slate-50 p-3 rounded-xl border border-slate-100">
                            <span class="font-bold text-slate-700">${escapeHtml(name)}</span>
                            <span class="bg-google-blue-light text-google-blue px-3 py-1 rounded-full text-xs font-bold">${count} Stories</span>
                        </div>
                    `;
                } else {
                    html += `
                        <div class="flex justify-between items-center bg-slate-50 p-3 rounded-xl border border-slate-100">
                            <span class="font-bold text-slate-700">${escapeHtml(name)}</span>
                            <span class="bg-google-green-light text-google-green px-3 py-1 rounded-full text-xs font-bold">Free</span>
                        </div>
                    `;
                }
            });
            html += `</div>`;
            body.innerHTML = html;
        }
        modal.classList.remove('hidden');
        document.body.style.overflow = 'hidden';
    },
    showStaffDetails(role, type) {
        const regularNonBacklog = currentData.filter(s => !isBacklogStory(s) && isRegularStory(s));
        if (type === 'active') {
            const set = new Set();
            const activeStories = regularNonBacklog.filter(s => s.state !== 'Tested' && s.state !== 'Closed');
            activeStories.forEach(s => {
                if (role === 'dev' && s.assignedTo && s.assignedTo !== "Unassigned") set.add(s.assignedTo);
                else if (role === 'tester' && s.tester && s.tester !== "Unassigned") set.add(s.tester);
            });
            const list = Array.from(set).sort();
            const title = role === 'dev' ? '👨‍💻 Active Developers' : '🧪 Active Testers';
            this.showStaffModal(title, list, true);
        } else {
            const list = role === 'dev' ? this.getFreeStaff('dev') : this.getFreeStaff('tester');
            const title = role === 'dev' ? '🟢 Free Developers' : '🟣 Free Testers';
            this.showStaffModal(title, list, false);
        }
    },
    renderActiveCards() {
        const container = document.getElementById('active-cards-container');
        const searchTerm = document.getElementById('search-input')?.value.toLowerCase() || "";
        const tagSearchTerm = document.getElementById('tag-search-input')?.value.toLowerCase() || "";
        const nonBacklog = currentData.filter(s => !isBacklogStory(s) && isRegularStory(s));
        const activeStories = nonBacklog.filter(s => {
            const isNotFinished = s.state !== 'Tested' && s.state !== 'Closed';
            const matchesSearch =
                s.title.toLowerCase().includes(searchTerm) ||
                s.id.toString().includes(searchTerm) ||
                s.tester.toLowerCase().includes(searchTerm) ||
                s.assignedTo.toLowerCase().includes(searchTerm) ||
                (s.area && s.area.toLowerCase().includes(searchTerm));
            const matchesTags = tagSearchTerm === "" || (s.customTags && s.customTags.some(tag => tag.toLowerCase().includes(tagSearchTerm)));
            return isNotFinished && matchesSearch && matchesTags;
        });

        if (activeStories.length === 0) {
            container.innerHTML = `<div class="col-span-full text-center py-20 text-gray-400">${searchTerm ? 'لا توجد نتائج تطابق بحثك.' : 'No active stories found.'}</div>`;
            return;
        }

        const groupedStories = activeStories.reduce((groups, story) => {
            const area = story.area || "General";
            if (!groups[area]) groups[area] = [];
            groups[area].push(story);
            return groups;
        }, {});

        container.innerHTML = Object.keys(groupedStories).map(area => {
            const storiesInArea = groupedStories[area].sort((a, b) => {
                if (a.priority !== b.priority) return a.priority - b.priority;
                const isALate = a.calc.finalEnd instanceof Date && new Date() > a.calc.finalEnd;
                const isBLate = b.calc.finalEnd instanceof Date && new Date() > b.calc.finalEnd;
                return isBLate - isALate;
            });

            return `
                <div class="col-span-full mt-8 mb-4">
                    <h2 class="text-xl font-bold text-slate-700 flex items-center gap-2">
                        <span class="w-2 h-6 bg-google-blue rounded-full"></span>
                        ${escapeHtml(area)} 
                        <span class="text-sm font-normal text-gray-400">(${storiesInArea.length})</span>
                    </h2>
                </div>
                ${storiesInArea.map(s => {
                    const now = new Date();
                    const isLate = s.calc.finalEnd instanceof Date && now > s.calc.finalEnd;
                    const hasError = s.calc.error;
                    const devTasks = s.tasks.filter(t => ["Development", "DB Modification"].includes(t['Activity']));
                    const totalDevEffort = devTasks.reduce((acc, t) => acc + parseFloat(t['Original Estimation'] || 0), 0);
                    let activeDaysCount = 0;
                    const devActivatedDates = devTasks.map(t => t['Activated Date']).filter(d => d).sort();
                    if (devActivatedDates.length > 0) {
                        const startDate = new Date(devActivatedDates[0]);
                        const today = new Date();
                        let current = new Date(startDate);
                        while (current <= today) {
                            if (dateEngine.isWorkDay(current, s.assignedTo)) activeDaysCount++;
                            current.setDate(current.getDate() + 1);
                        }
                    }
                    let activeDaysColor = "bg-google-green";
                    if (activeDaysCount >= 7 && activeDaysCount <= 12) activeDaysColor = "bg-google-yellow";
                    else if (activeDaysCount > 12) activeDaysColor = "bg-google-red shadow-google-red/20 animate-pulse";

                    const devVacDaysNow = devActivatedDates.length > 0 ? dateEngine.countVacationDaysUntilNow(devActivatedDates[0], s.assignedTo) : 0;
                    let devStartDisplay = devActivatedDates.length > 0 ? new Date(devActivatedDates[0]).toLocaleDateString('en-GB') : "TBD";
                    let devResolveDate = "N/A";
                    const resolvedDevTasks = devTasks.filter(t => ['Closed', 'Resolved', 'To Be Reviewed'].includes(t['State']) && t['Changed Date']);
                    if (resolvedDevTasks.length > 0) {
                        const latestTask = resolvedDevTasks.sort((a, b) => new Date(b['Changed Date']) - new Date(a['Changed Date']))[0];
                        devResolveDate = new Date(latestTask['Changed Date']).toLocaleDateString('en-GB');
                    }

                    const testTasks = s.tasks.filter(t => t['Activity'] === 'Testing');
                    const totalTestEffort = testTasks.reduce((acc, t) => acc + parseFloat(t['Original Estimation'] || 0), 0);
                    let testStartDisplay = "Waiting";
                    const execTask = s.tasks.find(t => t['Title'] && t['Title'].toLowerCase().includes('execution'));
                    const testVacDaysNow = (execTask && execTask['Activated Date']) ? dateEngine.countVacationDaysUntilNow(execTask['Activated Date'], s.tester) : 0;
                    if (execTask && execTask['Activated Date']) testStartDisplay = new Date(execTask['Activated Date']).toLocaleDateString('en-GB');

                    const isDevLate = s.calc.devEnd instanceof Date && now > s.calc.devEnd && (s.state !== 'Resolved' && s.state !== 'Tested' && s.state !== 'Closed');
                    const devLightColor = (s.state === 'Resolved' || s.state === 'Tested' || s.state === 'Closed') ? 'bg-google-green shadow-[0_0_8px_rgba(34,197,94,0.6)]' : (isDevLate ? 'bg-google-red animate-pulse shadow-[0_0_8px_rgba(239,68,68,0.6)]' : 'bg-gray-300');
                    const isTestLate = s.calc.testEnd instanceof Date && now > s.calc.testEnd && (s.state !== 'Tested' && s.state !== 'Closed');
                    const testLightColor = (s.state === 'Tested' || s.state === 'Closed') ? 'bg-google-green shadow-[0_0_8px_rgba(34,197,94,0.6)]' : (isTestLate ? 'bg-google-red animate-pulse shadow-[0_0_8px_rgba(239,68,68,0.6)]' : 'bg-gray-300');

                    const nonTestTasks = s.tasks.filter(t => t['Activity'] !== 'Testing' && t['Activity'] !== 'Preparation');
                    const totalDevTasks = nonTestTasks.length;
                    const completedDevTasks = nonTestTasks.filter(t => ['Closed', 'To Be Reviewed', 'Resolved'].includes(t['State'])).length;
                    const devProgressPercent = totalDevTasks > 0 ? Math.round((completedDevTasks / totalDevTasks) * 100) : 0;

                    const totalBugs = s.bugs ? s.bugs.length : 0;
                    const completedBugs = s.bugs ? s.bugs.filter(b => ['Closed', 'Resolved'].includes(b['State'])).length : 0;
                    const totalBugEffort = s.bugs ? s.bugs.reduce((acc, b) => acc + parseFloat(b['Original Estimation'] || 0), 0) : 0;
                    const completedBugEffort = s.bugs ? s.bugs.filter(b => ['Closed', 'Resolved'].includes(b['State'])).reduce((acc, b) => acc + parseFloat(b['Original Estimation'] || 0), 0) : 0;
                    const remainingBugEffort = Math.max(0, totalBugEffort - completedBugEffort);
                    const bugProgressPercent = totalBugEffort > 0 ? Math.round((completedBugEffort / totalBugEffort) * 100) : 0;

                    const testCases = s.testCases || [];
                    const totalTC = testCases.length;
                    const completedTC = testCases.filter(tc => ['Pass', 'Fail', 'Not Applicable'].includes(tc.state)).length;
                    const progressPercent = totalTC > 0 ? Math.round((completedTC / totalTC) * 100) : 0;

                    let statusColor = isLate ? "status-delayed" : (hasError ? "bg-amber-100 text-amber-700" : "status-active");
                    const statusText = isLate ? `Overdue ⚠️ (${s.state})` : s.state;

                    const tagDropdownHtml = renderTagDropdown(s.id, s.customTags || []);
                    const projectSelectHtml = renderProjectSelect(s);
                    const commentsHtml = renderComments(s);
                    const commentsCount = getStandupComments(s.id).length;

                    return `
                    <div class="card relative p-5 border-gray-100 hover:border-google-blue transition-all overflow-visible mb-4">
                        ${activeDaysCount > 0 ? `
                        <div class="absolute top-0 right-0 mt-8 mr-4 flex flex-col items-center justify-center ${activeDaysColor} text-white w-14 h-14 rounded-xl shadow-lg transform rotate-3 z-10 transition-colors duration-500">
                            <span class="text-xl font-black leading-none">${activeDaysCount}</span>
                            <span class="text-[8px] uppercase font-bold">Days</span>
                        </div>
                        ` : ''}
                        <div class="flex-1">
                            <div class="flex justify-between items-start mb-4">
                                <div class="flex gap-2">
                                    <span class="status-badge ${statusColor}">${escapeHtml(statusText)}</span>
                                    <span class="px-2 py-0.5 rounded bg-gray-100 text-[10px] font-bold text-gray-600">P${escapeHtml(s.priority || 999)}</span>
                                </div>
                                <span onclick="ui.openStoryModal('${s.id}')" class="text-xs font-mono text-gray-400 cursor-pointer hover:text-google-blue">#${s.id} 🔍</span>
                            </div>
                            <div class="flex flex-wrap gap-1 mt-2 mb-3">
                                ${s.tags.map(t => `<span class="px-2 py-0.5 bg-google-red-light text-google-red border border-google-red/30 rounded text-[10px] font-semibold">${escapeHtml(t)}</span>`).join('')}
                            </div>
                            <div class="flex flex-wrap items-center gap-1.5 mb-4 border-b border-dashed border-gray-100 pb-3 overflow-visible">
                                ${(s.customTags || []).map(tag => `
                                    <span class="inline-flex items-center gap-1 px-2 py-1 bg-purple-100 text-purple-700 border border-purple-200 rounded-md text-[10px] font-bold">
                                        ${escapeHtml(tag)}
                                        <button onclick="tagManager.toggleTagInStory('${s.id}', '${encodeURIComponent(tag)}')" class="hover:text-purple-900 font-black ml-1">×</button>
                                    </span>
                                `).join('')}
                                ${tagDropdownHtml}
                            </div>
                            <h3 onclick="ui.openStoryModal('${s.id}')" class="text-lg font-bold text-slate-800 mb-1 leading-tight cursor-pointer">${escapeHtml(s.title)}</h3>
                            ${projectSelectHtml}
                            <div class="grid grid-cols-2 gap-4 py-4 border-t border-gray-50 mt-4">
                                <div>
                                    <div class="flex items-center gap-2 mb-1">
                                        <div class="w-2.5 h-2.5 rounded-full ${devLightColor}"></div>
                                        <p class="text-[10px] uppercase text-gray-400 font-bold">Development</p>
                                    </div>
                                    <div class="flex flex-col gap-0.5">
                                        <p class="text-sm font-medium text-slate-700 flex items-center gap-2">
                                            <span class="w-6 h-6 rounded-full bg-slate-100 flex items-center justify-center text-[10px]">🛠</span> ${escapeHtml(s.assignedTo)}
                                        </p>
                                        <div class="ml-8 mt-1">
                                            <div class="flex justify-between items-center mb-0.5">
                                                <span class="text-[9px] text-gray-400 font-bold">Tasks: ${completedDevTasks}/${totalDevTasks}</span>
                                                <span class="text-[9px] text-google-blue font-bold">${devProgressPercent}%</span>
                                            </div>
                                            <div class="w-full bg-gray-100 h-1 rounded-full overflow-hidden mb-1">
                                                <div class="bg-google-blue h-full" style="width: ${devProgressPercent}%"></div>
                                            </div>
                                            ${totalBugs > 0 ? `
                                            <div class="mb-1">
                                                <div class="flex justify-between items-center mb-0.5">
                                                    <span class="text-[9px] text-gray-400 font-bold">Bugs: ${completedBugs}/${totalBugs}</span>
                                                    <span class="text-[9px] text-google-red font-bold">${bugProgressPercent}%</span>
                                                </div>
                                                <div class="w-full bg-gray-100 h-1 rounded-full overflow-hidden">
                                                    <div class="bg-google-red h-full" style="width: ${bugProgressPercent}%"></div>
                                                </div>
                                                ${totalBugEffort > 0 ? `
                                                <div class="flex justify-between items-center mt-1 text-[10px] text-gray-500">
                                                    <span class="font-bold">Bug Effort:</span>
                                                    <span class="font-mono">${remainingBugEffort.toFixed(1)}/${totalBugEffort.toFixed(1)}h</span>
                                                    <span class="text-xs font-bold ${remainingBugEffort === 0 ? 'text-google-green' : 'text-amber-600'}">${bugProgressPercent}%</span>
                                                </div>
                                                ` : ''}
                                            </div>
                                            ` : ''}
                                            <p class="text-[10px] text-gray-500 mt-1 font-medium">Start: ${escapeHtml(devStartDisplay)}</p>
                                            ${devVacDaysNow > 0 ? `<p class="text-[10px] text-orange-600 font-bold">🏖 Vac (Now): ${devVacDaysNow} Days</p>` : ''}
                                            <p class="text-[10px] text-google-green font-bold">Resolved: ${escapeHtml(devResolveDate)}</p>
                                            <p class="text-[10px] text-google-blue font-bold">Est: ${totalDevEffort}h</p>
                                        </div>
                                    </div>
                                </div>
                                <div>
                                    <div class="flex items-center gap-2 mb-1">
                                        <div class="w-2.5 h-2.5 rounded-full ${testLightColor}"></div>
                                        <p class="text-[10px] uppercase text-gray-400 font-bold">Testing</p>
                                    </div>
                                    <div class="flex flex-col gap-0.5">
                                        <p class="text-sm font-medium text-slate-700 flex items-center gap-2">
                                            <span class="w-6 h-6 rounded-full bg-slate-100 flex items-center justify-center text-[10px]">🔍</span> ${escapeHtml(s.tester)}
                                        </p>
                                        <div class="ml-8 mt-1">
                                            <div class="flex justify-between items-center mb-0.5">
                                                <span class="text-[9px] text-gray-400 font-bold">TCs: ${completedTC}/${totalTC}</span>
                                                <span class="text-[9px] text-google-blue font-bold">${progressPercent}%</span>
                                            </div>
                                            <div class="w-full bg-gray-100 h-1 rounded-full overflow-hidden mb-1">
                                                <div class="bg-google-blue h-full" style="width: ${progressPercent}%"></div>
                                            </div>
                                            <p class="text-[10px] text-gray-500 mt-1 font-medium">Start: ${escapeHtml(testStartDisplay)}</p>
                                            ${testVacDaysNow > 0 ? `<p class="text-[10px] text-orange-600 font-bold">🏖 Vac (Now): ${testVacDaysNow} Days</p>` : ''}
                                            <p class="text-[10px] text-google-blue font-bold">Est QA: ${totalTestEffort}h</p>
                                        </div>
                                    </div>
                                </div>
                            </div>
                            <div class="mt-2 pt-4 border-t border-gray-50 bg-slate-50/30 -mx-5 px-5">
                                <label class="text-[10px] font-black text-gray-400 uppercase tracking-wider mb-2 block">Standup Updates</label>
                                <div class="flex gap-2 mb-3">
                                    <input type="text" placeholder="Add comment and press Enter..." class="form-input form-input-sm flex-1" onkeypress="if(event.key === 'Enter') { commentManager.updateComment('${s.id}', this.value); this.value=''; }">
                                </div>
                                ${commentsHtml || '<p class="text-[10px] text-gray-400 italic py-1">No updates recorded yet.</p>'}
                            </div>
                        </div>
                        <div class="${isLate ? 'bg-google-red-light' : 'bg-slate-50'} p-4 flex justify-between items-center border-t border-gray-100 -mx-5 -mb-5 rounded-b-xl">
                            <div class="flex flex-col">
                                <span class="text-[10px] uppercase font-bold text-gray-400">Target Delivery</span>
                                <span class="text-sm font-bold ${isLate ? 'text-google-red' : 'text-slate-700'}">${s.calc.finalEnd instanceof Date ? s.calc.finalEnd.toLocaleDateString('en-GB') : 'Waiting'}</span>
                            </div>
                            <span class="text-xl">${isLate ? '⚠️' : '🗓️'}</span>
                        </div>
                    </div>
                    `;
                }).join('')}
            `;
        }).join('');
    },
    renderKanban() {
        const container = document.getElementById('kanban-container');
        const filterSelect = document.getElementById('kanban-ba-filter');
        const searchInput = document.getElementById('kanban-search-input');
        const tagSearchInput = document.getElementById('kanban-tag-search-input');

        const searchTerm = searchInput ? searchInput.value.toLowerCase() : "";
        const tagSearchTerm = tagSearchInput ? tagSearchInput.value.toLowerCase() : "";

        const matchesSearch = (s) => {
            if (!searchTerm) return true;
            return (s.title && s.title.toLowerCase().includes(searchTerm)) ||
                (s.id && s.id.toString().includes(searchTerm)) ||
                (s.assignedTo && s.assignedTo.toLowerCase().includes(searchTerm)) ||
                (s.tester && s.tester.toLowerCase().includes(searchTerm)) ||
                (s.area && s.area.toLowerCase().includes(searchTerm));
        };
        const matchesTag = (s) => {
            if (!tagSearchTerm) return true;
            const allTags = [...(s.tags || []), ...(s.customTags || [])];
            return allTags.some(t => t.toLowerCase().includes(tagSearchTerm));
        };

        const allStoriesForAreas = [...currentData.filter(s => !isBacklogStory(s) && isRegularStory(s)), ...db.backlogStories];
        if (allStoriesForAreas.length === 0) {
            container.innerHTML = `<div class="text-center py-20 text-gray-400 col-span-full">لا توجد قصص لعرضها.</div>`;
            return;
        }

        const areas = [...new Set(allStoriesForAreas.map(s => s.area || "General"))].sort();
        const currentSelected = Array.from(filterSelect.selectedOptions).map(opt => opt.value);
        filterSelect.multiple = true;
        filterSelect.size = Math.min(areas.length, 5);
        filterSelect.innerHTML = areas.map(a => {
            const selected = currentSelected.includes(a) ? 'selected' : '';
            return `<option value="${escapeHtml(a)}" ${selected}>${escapeHtml(a)}</option>`;
        }).join('');
        filterSelect.onchange = () => { this.renderKanban(); };

        let selectedAreas = Array.from(filterSelect.selectedOptions).map(opt => opt.value);
        if (selectedAreas.length === 0) selectedAreas = areas;

        const filteredRegular = currentData
            .filter(s => !isBacklogStory(s) && isRegularStory(s) && selectedAreas.includes(s.area || "General"))
            .filter(s => matchesSearch(s) && matchesTag(s))
            .sort((a, b) => (a.priority || 999) - (b.priority || 999));

        const filteredBacklog = db.backlogStories
            .filter(s => isRegularStory(s) && selectedAreas.includes(s.area || "General"))
            .filter(s => matchesSearch(s) && matchesTag(s))
            .sort((a, b) => (a.priority || 999) - (b.priority || 999));

        const states = ["Active", "Active - With Bugs", "Resolved", "Tested", "On-Hold"];

        let html = '';
        html += `
            <div class="flex flex-nowrap gap-4 overflow-x-auto pb-4">
                <div class="kanban-column bg-purple-50 border-purple-200">
                    <div class="kanban-column-header">
                        <span>Backlog</span>
                        <span class="bg-purple-200 text-purple-800 text-xs px-2 py-0.5 rounded-full">${filteredBacklog.length}</span>
                    </div>
                    <div class="space-y-3 overflow-y-auto">
                        ${filteredBacklog.map(s => createStoryCard(s, { mode: 'backlog', showProjectSelect: true, showTagDropdown: true, showCommentsButton: false })).join('')}
                        ${filteredBacklog.length === 0 ? '<div class="text-center py-10 text-gray-300 text-sm italic">No backlog items</div>' : ''}
                    </div>
                </div>
        `;
        html += states.map(state => {
            const storiesInState = filteredRegular.filter(s => s.state === state);
            return `
                <div class="kanban-column">
                    <div class="kanban-column-header">
                        <span>${escapeHtml(state)}</span>
                        <span class="bg-gray-200 text-gray-700 text-xs px-2 py-0.5 rounded-full">${storiesInState.length}</span>
                    </div>
                    <div class="space-y-3 overflow-y-auto">
                        ${storiesInState.map(s => createStoryCard(s, { mode: 'regular', showProjectSelect: true, showTagDropdown: true })).join('')}
                        ${storiesInState.length === 0 ? '<div class="text-center py-10 text-gray-300 text-sm italic">Empty column</div>' : ''}
                    </div>
                </div>
            `;
        }).join('');
        html += `</div>`;
        container.innerHTML = html;
    },
    renderSupportKanban() {
        const container = document.getElementById('support-kanban-container');
        const filterSelect = document.getElementById('support-kanban-ba-filter');
        const supportLogs = currentData.filter(s => s.type === 'Support log');
        if (supportLogs.length === 0) {
            container.innerHTML = `<div class="text-center py-20 text-gray-400 col-span-full">No Support logs found.</div>`;
            return;
        }
        const areas = [...new Set(supportLogs.map(s => s.area || "General"))].sort();
        const currentSelected = filterSelect.value;
        filterSelect.innerHTML = '<option value="all">All Areas</option>' + areas.map(a => `<option value="${escapeHtml(a)}" ${a === currentSelected ? 'selected' : ''}>${escapeHtml(a)}</option>`).join('');
        const selectedArea = filterSelect.value;
        let filteredLogs = supportLogs;
        if (selectedArea !== 'all') filteredLogs = filteredLogs.filter(s => (s.area || "General") === selectedArea);
        const allStates = [...new Set(filteredLogs.map(s => s.state))].sort();
        const preferredOrder = ['Active', 'Resolved', 'Closed', 'On-Hold', 'Reactive', 'Rejected'];
        const orderedStates = preferredOrder.filter(st => allStates.includes(st));
        const remainingStates = allStates.filter(st => !preferredOrder.includes(st)).sort();
        const finalStates = [...orderedStates, ...remainingStates];

        let html = '';
        finalStates.forEach(state => {
            const logsInState = filteredLogs.filter(s => s.state === state);
            html += `
                <div class="kanban-column">
                    <div class="kanban-column-header">
                        <span>${escapeHtml(state)}</span>
                        <span class="bg-gray-200 text-gray-700 text-xs px-2 py-0.5 rounded-full">${logsInState.length}</span>
                    </div>
                    <div class="space-y-3 overflow-y-auto">
                        ${logsInState.map(s => createStoryCard(s, { mode: 'support', showProjectSelect: false, showTagDropdown: true, showCommentsButton: true })).join('')}
                        ${logsInState.length === 0 ? '<div class="text-center py-10 text-gray-300 text-sm italic">Empty column</div>' : ''}
                    </div>
                </div>
            `;
        });
        container.innerHTML = html;
    },
    generateWeeklyReport() {
        const filterSelect = document.getElementById('kanban-ba-filter');
        if (!filterSelect) return;
        const selectedOptions = Array.from(filterSelect.selectedOptions);
        let selectedAreas = selectedOptions.map(opt => opt.value);
        const allAreas = [...new Set([
            ...currentData.filter(s => !isBacklogStory(s) && isRegularStory(s)).map(s => s.area || "General"),
            ...db.backlogStories.map(s => s.area || "General")
        ])];
        if (selectedAreas.length === 0) selectedAreas = allAreas;
        const reportData = {};
        const targetStates = ['Active', 'Active - With Bugs', 'Resolved', 'On-Hold'];
        const fifteenDaysAgo = new Date();
        fifteenDaysAgo.setDate(fifteenDaysAgo.getDate() - 15);
        selectedAreas.forEach(area => {
            const areaData = { states: {}, backlog: [], tested: [], comments: [] };
            targetStates.forEach(state => {
                areaData.states[state] = currentData.filter(s =>
                    !isBacklogStory(s) && isRegularStory(s) && (s.area || "General") === area && s.state === state
                );
            });
            areaData.backlog = db.backlogStories.filter(s => (s.area || "General") === area && isRegularStory(s));
            areaData.tested = currentData.filter(s =>
                !isBacklogStory(s) && isRegularStory(s) && (s.area || "General") === area &&
                s.state === 'Tested' && s.changedDate && new Date(s.changedDate) >= fifteenDaysAgo
            );
            areaData.comments = db.areaComments.filter(c => c.area === area);
            reportData[area] = areaData;
        });
        this.showWeeklyReportModal(reportData);
    },
    showWeeklyReportModal(reportData) {
        let modal = document.getElementById('weekly-report-modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'weekly-report-modal';
            modal.className = 'fixed inset-0 bg-black/50 flex items-center justify-center z-[2000] p-4';
            modal.innerHTML = `
                <div class="bg-white rounded-2xl shadow-2xl max-w-7xl w-full max-h-[90vh] flex flex-col relative" style="direction: rtl;">
                    <div class="flex justify-between items-center p-4 border-b sticky top-0 bg-white z-10 rounded-t-2xl">
                        <h3 class="text-xl font-bold text-slate-800">📋 التقرير الأسبوعي</h3>
                        <div class="flex gap-2">
                            <button onclick="window.print()" class="btn btn-primary">🖨️ طباعة</button>
                            <button onclick="document.getElementById('weekly-report-modal').style.display='none'" class="text-slate-500 hover:text-google-red text-2xl font-bold leading-none">&times;</button>
                        </div>
                    </div>
                    <div class="p-6 overflow-y-auto" id="weekly-report-content"></div>
                </div>
            `;
            document.body.appendChild(modal);
            const style = document.createElement('style');
            style.textContent = `
                @media print {
                    body * { visibility: hidden; }
                    #weekly-report-modal, #weekly-report-modal * { visibility: visible; }
                    #weekly-report-modal {
                        position: absolute;
                        left: 0;
                        top: 0;
                        width: 100%;
                        background: white;
                        margin: 0;
                        padding: 15px;
                        box-shadow: none;
                        border-radius: 0;
                        max-height: none;
                        overflow: visible;
                        direction: rtl;
                    }
                    #weekly-report-modal .sticky, #weekly-report-modal .border-b { position: relative; top: auto; }
                    #weekly-report-modal .p-6 { padding: 10px; }
                    #weekly-report-modal button { display: none !important; }
                    .page-break-after { page-break-after: always; }
                    .report-story-card { border: 1px solid #e2e8f0; padding: 4px 8px; margin-bottom: 4px; border-radius: 4px; font-size: 10px !important; }
                    .report-story-card .title { font-size: 10px !important; font-weight: bold; }
                    .report-tag { display: inline-block; padding: 0 4px; margin: 1px; font-size: 8px; border-radius: 2px; background: #f1f5f9; border: 1px solid #cbd5e1; }
                    .report-custom-tag { background: #f3e8ff; border-color: #a78bfa; }
                    .report-comment { background: #f0f4ff; padding: 2px 6px; border-radius: 3px; border-right: 2px solid #6366f1; margin-top: 2px; font-size: 9px; }
                    .state-column { border: 1px solid #e2e8f0; border-radius: 6px; padding: 6px; background: #f8fafc; }
                    .state-column h4 { font-size: 11px; font-weight: bold; margin-bottom: 4px; }
                }
            `;
            modal.querySelector('.bg-white').appendChild(style);
        }
        const content = document.getElementById('weekly-report-content');
        let html = '';
        const now = new Date();
        const dateStr = now.toLocaleDateString('ar-EG', { year: 'numeric', month: 'long', day: 'numeric' });
        html += `<div class="text-center mb-6 border-b pb-4">
            <h1 class="text-2xl font-bold text-slate-800">تقرير الحالة الأسبوعي</h1>
            <p class="text-sm text-gray-500">تاريخ التقرير: ${escapeHtml(dateStr)}</p>
        </div>`;
        const truncateTitle = (title) => {
            if (!title) return '';
            const words = title.split(' ');
            if (words.length <= 6) return title;
            return words.slice(0, 6).join(' ') + ' ...';
        };
        for (const area in reportData) {
            const data = reportData[area];
            const { states, backlog, tested, comments } = data;
            html += `<div class="mb-12 page-break-after">`;
            html += `<h2 class="text-xl font-bold text-google-blue border-b-2 border-google-blue/30 pb-2 mb-4">📍 ${escapeHtml(area)}</h2>`;

            if (comments && comments.length > 0) {
                html += `<div class="mb-6 p-4 bg-google-yellow-light rounded-lg border border-google-yellow/30">`;
                html += `<h3 class="font-bold text-amber-700 text-sm flex items-center gap-2 mb-3">💬 تعليقات عامة على المنطقة</h3>`;
                html += `<div class="space-y-2">`;
                comments.forEach(c => {
                    html += `
                        <div class="bg-white p-2 rounded border border-amber-100 flex justify-between items-start gap-2">
                            <span class="text-sm text-slate-700" style="direction: rtl; text-align: right;">${escapeHtml(c.text)}</span>
                            <span class="text-[10px] text-gray-400 whitespace-nowrap">${escapeHtml(c.timestamp)}</span>
                        </div>
                    `;
                });
                html += `</div></div>`;
            } else {
                html += `<div class="text-gray-400 text-sm italic mb-4">لا توجد تعليقات عامة على هذه المنطقة.</div>`;
            }

            html += `<div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">`;
            const stateOrder = ['Active', 'Active - With Bugs', 'Resolved', 'On-Hold'];
            stateOrder.forEach(state => {
                const stories = states[state] || [];
                html += `<div class="state-column bg-gray-50 rounded-lg border border-gray-200 p-3">`;
                html += `<h4 class="font-bold text-sm text-slate-700 border-b pb-1 mb-2">${escapeHtml(state)} (${stories.length})</h4>`;
                if (stories.length === 0) {
                    html += `<div class="text-gray-400 text-[10px] italic">لا توجد</div>`;
                } else {
                    stories.forEach(s => {
                        const lastComment = getStandupComments(s.id).length > 0 ? getStandupComments(s.id)[getStandupComments(s.id).length - 1] : null;
                        const azureTags = s.tags || [];
                        const customTags = s.customTags || [];
                        const allTags = [...new Set([...azureTags, ...customTags])];
                        html += `<div class="report-story-card bg-white rounded border border-gray-100 p-2 mb-2 shadow-sm">`;
                        html += `<div class="flex justify-between items-start gap-2">`;
                        html += `<span class="font-mono text-[9px] text-gray-400">#${s.id}</span>`;
                        html += `<span class="title text-xs font-bold text-slate-800 flex-1">${escapeHtml(truncateTitle(s.title))}</span>`;
                        html += `</div>`;
                        if (allTags.length > 0) {
                            html += `<div class="flex flex-wrap gap-1 mt-1">`;
                            allTags.forEach(tag => {
                                const isCustom = customTags.includes(tag);
                                html += `<span class="report-tag px-1.5 py-0.5 text-[8px] font-bold rounded ${isCustom ? 'bg-purple-100 text-purple-700 border border-purple-300 report-custom-tag' : 'bg-gray-100 text-gray-600 border border-gray-200'}">${escapeHtml(tag)}${isCustom ? ' ★' : ''}</span>`;
                            });
                            html += `</div>`;
                        }
                        if (lastComment) {
                            html += `<div class="report-comment text-[9px] text-slate-600 mt-1">`;
                            html += `<span class="font-bold text-google-blue">اخر ستاندب:</span> `;
                            html += `<span>"${escapeHtml(lastComment.text)}"</span>`;
                            html += `<span class="text-[8px] text-gray-400 mr-1">(${escapeHtml(lastComment.date)})</span>`;
                            html += `</div>`;
                        }
                        html += `</div>`;
                    });
                }
                html += `</div>`;
            });
            html += `</div>`;

            if (backlog.length > 0) {
                const sortedBacklog = [...backlog].sort((a, b) => (a.priority || 999) - (b.priority || 999));
                const top5 = sortedBacklog.slice(0, 5);
                const withoutPriority = sortedBacklog.filter(s => s.priority === 999 || s.priority === undefined || s.priority === null);
                html += `<div class="mt-4 p-3 bg-purple-50 rounded-lg border border-purple-200">`;
                html += `<h3 class="font-bold text-purple-700 text-sm">📋 الباك لوج (${backlog.length})</h3>`;
                html += `<div class="flex flex-wrap gap-3 mt-2">`;
                top5.forEach(s => {
                    html += `<div class="bg-white px-3 py-1 rounded-full border border-purple-100 text-xs flex items-center gap-2 shadow-sm">`;
                    html += `<span class="font-mono text-gray-400">#${s.id}</span>`;
                    html += `<span class="font-medium text-slate-700">${escapeHtml(truncateTitle(s.title))}</span>`;
                    html += `<span class="bg-gray-200 text-gray-700 px-1.5 py-0.5 rounded text-[9px] font-bold">P${escapeHtml(s.priority)}</span>`;
                    html += `</div>`;
                });
                if (top5.length < backlog.length) html += `<span class="text-xs text-gray-400">... وغيرها</span>`;
                if (withoutPriority.length > 0) html += `<div class="w-full text-xs text-google-red mt-1">⚠️ يوجد ${withoutPriority.length} قصة بدون أولوية (Priority = 999)</div>`;
                html += `</div></div>`;
            } else {
                html += `<div class="text-gray-400 text-sm italic mt-2">لا يوجد باك لوج في هذه المنطقة.</div>`;
            }

            if (tested.length > 0) {
                html += `<div class="mt-4 p-3 bg-google-green-light rounded-lg border border-google-green/30">`;
                html += `<h3 class="font-bold text-google-green text-sm">✅ تم تسليمها (آخر 15 يوم) (${tested.length})</h3>`;
                html += `<div class="flex flex-wrap gap-2 mt-2">`;
                tested.forEach(s => {
                    html += `<span class="bg-white text-google-green px-2 py-0.5 rounded-full border border-google-green/20 text-xs font-mono">#${s.id}</span>`;
                });
                html += `</div></div>`;
            } else {
                html += `<div class="text-gray-400 text-sm italic mt-2">لا توجد قصص مسلمة في آخر 15 يوم.</div>`;
            }

            html += `</div>`;
        }
        content.innerHTML = html;
        modal.style.display = 'flex';
    },
    renderDelivery() {
        const container = document.getElementById('delivery-grid');
        const searchTerm = document.getElementById('search-delivery-input')?.value.toLowerCase() || "";
        const nonBacklog = currentData.filter(s => !isBacklogStory(s));
        const regularStories = nonBacklog.filter(s => isRegularStory(s));
        const allTested = regularStories.filter(s => s.state === 'Tested' || s.state === 'Closed');
        const pendingStories = allTested.filter(s => {
            const isPending = !db.deliveryLogs.some(l => l.storyId === s.id.toString());
            const matchesSearch = s.title.toLowerCase().includes(searchTerm) || s.id.toString().includes(searchTerm) || (s.area && s.area.toLowerCase().includes(searchTerm));
            return isPending && matchesSearch;
        });
        const completedStories = db.deliveryLogs.map(log => {
            const story = regularStories.find(s => s.id.toString() === log.storyId.toString());
            return { ...story, logData: log, title: story ? story.title : "Story not in current CSV", area: story ? story.area : "N/A" };
        }).filter(s => {
            if (!s.id) return false;
            const matchesSearch = s.title.toLowerCase().includes(searchTerm) || s.logData.storyId.toString().includes(searchTerm) || s.logData.to.toLowerCase().includes(searchTerm) || (s.area && s.area.toLowerCase().includes(searchTerm));
            return matchesSearch;
        }).reverse();

        const createCardHtml = (s, isLogged) => {
            const tags = [...new Set([...(s.tags || []), ...(s.customTags || [])])];
            const tagsHtml = tags.length > 0 ? `
                <div class="flex flex-wrap gap-1 mb-2">
                    ${tags.map(tag => `
                        <span class="px-1.5 py-0.5 rounded text-[8px] font-bold uppercase tracking-tighter ${(s.customTags || []).includes(tag) ? 'bg-purple-200 text-purple-700 border border-purple-300' : 'bg-slate-100 text-slate-500 border border-slate-200'}">
                            ${escapeHtml(tag.trim())}
                        </span>
                    `).join('')}
                </div>
            ` : '';

            return `
                <div class="card p-4 border-2 transition-all ${isLogged ? 'border-gray-200 shadow-none' : 'border-google-blue/30 shadow-sm hover:border-google-blue'}">
                    ${tagsHtml}
                    <div class="flex justify-between items-start mb-2">
                        <span class="text-[10px] font-mono text-gray-400">#${isLogged ? s.logData.storyId : s.id}</span>
                    </div>
                    <div class="font-bold text-slate-800 mb-4 leading-snug">${escapeHtml(s.title)}</div>
                    <span class="text-xs font-bold ${isLogged ? 'text-google-green' : 'text-google-blue italic'}">${isLogged ? '✓ تم التسليم' : '*Tested*'}</span>
                    <div class="text-[10px] text-gray-500 mb-2 italic">Area: ${escapeHtml(s.area || "General")}</div>
                    ${isLogged ? `
                        <div class="relative group mt-2" dir="rtl">
                            <div class="text-xs bg-google-green-light text-google-green p-3 pr-12 rounded-lg border border-google-green/30 min-h-[60px] leading-relaxed">
                                <b>المستلم:</b> ${escapeHtml(s.logData.to)}<br>
                                <b>التاريخ:</b> ${escapeHtml(s.logData.date)}
                            </div>
                            ${currentUser && currentUser.role === 'admin' ? `
                                <button onclick="ui.editDelivery('${s.logData.storyId}')" class="absolute top-2 left-2 bg-white border border-google-green/30 shadow-sm text-gray-500 hover:text-google-blue hover:border-google-blue rounded-md p-1.5 text-[10px] transition-all z-10 flex items-center gap-1">
                                    <span>✏️</span>
                                    <span class="text-[9px] font-bold">تعديل</span>
                                </button>
                            ` : ''}
                        </div>
                    ` : (currentUser && currentUser.role === 'admin' ? `
                        <div class="flex gap-2 mt-auto">
                            <input id="to-${s.id}" placeholder="اسم المستلم..." class="form-input form-input-sm flex-1">
                            <button onclick="ui.markDelivered('${s.id}')" class="btn btn-primary text-xs">تأكيد</button>
                        </div>
                    ` : `<div class="text-xs text-gray-400 italic mt-auto">بانتظار تأكيد التسليم من الأدمن</div>`)}
                </div>
            `;
        };

        if (pendingStories.length === 0 && completedStories.length === 0) {
            container.innerHTML = `<div class="col-span-full text-center py-10 text-gray-400">${searchTerm ? 'لا توجد نتائج تطابق بحثك في قسم التسليم.' : 'لا توجد عناصر حالياً.'}</div>`;
            return;
        }

        let html = `
            <div class="col-span-full mb-4"><h3 class="text-lg font-bold text-google-blue flex items-center gap-2">📦 بانتظار التسليم (${pendingStories.length})</h3></div>
            ${pendingStories.map(s => createCardHtml(s, false)).join('') || '<div class="col-span-full text-center text-gray-400 py-4">لا توجد نتائج</div>'}
            <div class="col-span-full my-8 border-t-2 border-dashed border-gray-200"></div>
            <div class="col-span-full mb-4"><h3 class="text-lg font-bold text-gray-500 flex items-center gap-2">✅ تم التسليم مؤخراً (${completedStories.length})</h3></div>
            ${completedStories.map(s => createCardHtml(s, true)).join('') || '<div class="col-span-full text-center text-gray-400 py-4">لا توجد نتائج</div>'}
        `;
        container.innerHTML = html;
    },
    markDelivered(id) {
        if (currentUser.role !== 'admin') return ui.showToast("عذراً، لا تملك صلاحية تنفيذ هذا الإجراء.", "error");
        const to = document.getElementById(`to-${id}`).value;
        if (!to) return ui.showToast("اكتب المستلم", "error");
        db.deliveryLogs.push({ storyId: id, to, date: new Date().toLocaleDateString(), timestamp: Date.now() });
        dataProcessor.saveToGitHub();
        this.renderDelivery();
    },
    editDelivery(id) {
        if (currentUser.role !== 'admin') return;
        const confirmEdit = confirm("هل تريد إلغاء التسليم الحالي وتعديله؟");
        if (confirmEdit) {
            db.deliveryLogs = db.deliveryLogs.filter(log => log.storyId.toString() !== id.toString());
            dataProcessor.saveToGitHub().then(() => {
                this.renderDelivery();
                setTimeout(() => {
                    const input = document.getElementById(`to-${id}`);
                    if (input) { input.focus(); input.classList.add('ring-2', 'ring-orange-400'); }
                }, 100);
            });
        }
    },
    renderWorkload() {
        const container = document.getElementById('workload-container');
        if (!container) return;
        const nonBacklog = currentData.filter(s => !isBacklogStory(s));
        const areaGroups = {};
        const MAX_HOURS = 65;
        const globalTaskWorkers = new Set();
        nonBacklog.forEach(story => {
            const activeTasks = (story.tasks || []).filter(t => t['State'] !== 'To Be Reviewed' && t['State'] !== 'Closed' && parseFloat(t['Original Estimation'] || 0) > 0);
            activeTasks.forEach(t => {
                const worker = (t['Activity'] === 'Testing') ? story.tester : story.assignedTo;
                if (worker && worker !== "Unassigned") globalTaskWorkers.add(worker);
            });
        });
        const supportWorkersGlobal = new Set();
        const bugWorkersGlobal = new Set();
        nonBacklog.forEach(story => {
            if (story.type === 'Support log' && story.state !== 'Tested' && story.state !== 'Closed') {
                if (story.assignedTo && story.assignedTo !== "Unassigned") supportWorkersGlobal.add(story.assignedTo);
                if (story.tester && story.tester !== "Unassigned") supportWorkersGlobal.add(story.tester);
            }
        });
        nonBacklog.forEach(story => {
            if (story.bugs && story.bugs.length > 0) {
                story.bugs.forEach(bug => {
                    if (['New', 'Active'].includes(bug['State'])) {
                        const worker = bug['Assigned To'];
                        if (worker && worker !== "Unassigned") bugWorkersGlobal.add(worker);
                    }
                });
            }
        });
        nonBacklog.forEach(story => {
            const area = story.area || "General Business Area";
            if (!areaGroups[area]) areaGroups[area] = { developers: {}, testers: {}, allDevsInArea: new Set(), allTestersInArea: new Set(), activeDevStories: {}, activeTesterStories: {} };
            if (story.assignedTo && story.assignedTo !== "Unassigned") areaGroups[area].allDevsInArea.add(story.assignedTo);
            if (story.tester && story.tester !== "Unassigned") areaGroups[area].allTestersInArea.add(story.tester);
            const isActiveStory = story.state !== 'Tested' && story.state !== 'Closed';
            if (isActiveStory && (story.type === 'User Story' || story.type === 'CR')) {
                if (story.assignedTo && story.assignedTo !== "Unassigned") areaGroups[area].activeDevStories[story.assignedTo] = (areaGroups[area].activeDevStories[story.assignedTo] || 0) + 1;
                if (story.tester && story.tester !== "Unassigned") areaGroups[area].activeTesterStories[story.tester] = (areaGroups[area].activeTesterStories[story.tester] || 0) + 1;
            }
            const activeDevTasks = (story.tasks || []).filter(t => ["Development", "DB Modification"].includes(t['Activity']) && t['State'] !== 'To Be Reviewed' && t['State'] !== 'Closed');
            const dHours = activeDevTasks.reduce((acc, t) => acc + parseFloat(t['Original Estimation'] || 0), 0);
            if (dHours > 0) areaGroups[area].developers[story.assignedTo] = (areaGroups[area].developers[story.assignedTo] || 0) + dHours;
            const activeTestTasks = (story.tasks || []).filter(t => t['Activity'] === 'Testing' && t['State'] !== 'To Be Reviewed' && t['State'] !== 'Closed');
            const tHours = activeTestTasks.reduce((acc, t) => acc + parseFloat(t['Original Estimation'] || 0), 0);
            if (tHours > 0) areaGroups[area].testers[story.tester] = (areaGroups[area].testers[story.tester] || 0) + tHours;
        });
        const renderAvailableTag = (name) => {
            const isBusyGlobally = globalTaskWorkers.has(name);
            return `<span class="px-3 py-1.5 bg-white border border-slate-200 text-slate-600 text-[10px] font-bold rounded-full shadow-sm hover:border-google-green hover:text-google-green transition-colors flex items-center gap-1.5">${escapeHtml(name)}${isBusyGlobally ? '<span class="text-[8px] bg-google-yellow-light text-amber-600 px-1.5 py-0.5 rounded shadow-sm font-black ring-1 ring-amber-200">BUSY</span>' : ''}</span>`;
        };
        const areaEntries = Object.entries(areaGroups);
        container.innerHTML = areaEntries.map(([areaName, data], index) => {
            const activeDevs = Object.keys(data.activeDevStories).filter(name => data.activeDevStories[name] > 0);
            const activeDevsCount = activeDevs.length;
            const storiesInArea = nonBacklog.filter(s => (s.area || "General Business Area") === areaName);
            const testerStoriesCount = {};
            storiesInArea.forEach(s => {
                const isRelevant = s.state === 'Resolved' || s.state === 'Active' || s.state === 'Active - With Bugs';
                if (isRelevant && s.tester && s.tester !== "Unassigned") testerStoriesCount[s.tester] = (testerStoriesCount[s.tester] || 0) + 1;
            });
            const activeTesters = Object.keys(testerStoriesCount).filter(name => testerStoriesCount[name] > 0);
            const activeTestersCount = activeTesters.length;
            const devWipLimit = activeDevsCount * 2;
            const testerWipLimit = activeTestersCount * 2;
            const devActiveCount = storiesInArea.filter(s => s.state === 'Active' || s.state === 'Active - With Bugs').length;
            const resolvedStoriesCount = storiesInArea.filter(s => s.state === 'Resolved').length;
            const devWipUsage = devWipLimit > 0 ? Math.min((devActiveCount / devWipLimit) * 100, 100) : 0;
            const testerWipUsage = testerWipLimit > 0 ? Math.min((resolvedStoriesCount / testerWipLimit) * 100, 100) : 0;
            const allWorkers = new Set([...data.allDevsInArea, ...data.allTestersInArea]);
            const supportWorkersInArea = [];
            const bugWorkersInArea = [];
            allWorkers.forEach(worker => {
                if (supportWorkersGlobal.has(worker)) supportWorkersInArea.push(worker);
                else if (bugWorkersGlobal.has(worker)) bugWorkersInArea.push(worker);
            });
            const availableDevs = [...data.allDevsInArea].filter(name => !data.developers[name]).filter(name => !supportWorkersGlobal.has(name) && !bugWorkersGlobal.has(name));
            const availableTesters = [...data.allTestersInArea].filter(name => !data.testers[name]).filter(name => !supportWorkersGlobal.has(name) && !bugWorkersGlobal.has(name));
            const finalAvailableDevs = availableDevs.filter(name => !availableTesters.includes(name));
            return `
                <div class="mb-16 bg-white rounded-[3rem] shadow-2xl shadow-slate-200/50 overflow-hidden border border-slate-100 cursor-move transition-all duration-300 hover:shadow-google-blue/10" draggable="true" ondragstart="ui.handleAreaDragStart(event, ${index})" ondragover="ui.handleAreaDragOver(event)" ondrop="ui.handleAreaDrop(event, ${index})">
                    <div class="bg-gradient-to-r from-slate-800 to-slate-900 p-6 px-10 flex justify-between items-center pointer-events-none">
                        <div>
                            <h2 class="text-2xl font-black text-white tracking-tight flex items-center gap-3"><span class="w-4 h-4 bg-google-blue rounded-full shadow-[0_0_10px_rgba(99,102,241,0.8)]"></span>${escapeHtml(areaName)}</h2>
                            <p class="text-slate-400 text-[10px] uppercase tracking-[0.2em] font-bold mt-1">Resource Allocation & Availability</p>
                        </div>
                        <i class="fas fa-grip-vertical text-slate-600 text-xl"></i>
                    </div>
                    <div class="px-10 py-3 bg-slate-50/80 border-b border-slate-200 space-y-1.5">
                        <div class="flex items-center gap-2 text-xs">
                            <span class="font-bold text-slate-600 w-24">Dev WIP (Active):</span>
                            <span class="font-mono font-black text-google-blue w-10">${devWipLimit}</span>
                            <span class="font-mono font-black ${devActiveCount > devWipLimit ? 'text-google-red' : 'text-slate-700'} w-10">${devActiveCount}</span>
                            <div class="flex-1 h-1.5 bg-gray-200 rounded-full overflow-hidden"><div class="${devWipUsage > 80 ? 'bg-google-yellow' : 'bg-google-green'} h-full rounded-full transition-all duration-1000" style="width: ${devWipUsage}%"></div></div>
                            <span class="text-[10px] text-slate-400 font-mono w-10">${Math.round(devWipUsage)}%</span>
                        </div>
                        <div class="flex items-center gap-2 text-xs">
                            <span class="font-bold text-slate-600 w-24">QA WIP (Resolved):</span>
                            <span class="font-mono font-black text-purple-700 w-10">${testerWipLimit}</span>
                            <span class="font-mono font-black ${resolvedStoriesCount > testerWipLimit ? 'text-google-red' : 'text-slate-700'} w-10">${resolvedStoriesCount}</span>
                            <div class="flex-1 h-1.5 bg-gray-200 rounded-full overflow-hidden"><div class="${testerWipUsage > 80 ? 'bg-google-yellow' : 'bg-purple-500'} h-full rounded-full transition-all duration-1000" style="width: ${testerWipUsage}%"></div></div>
                            <span class="text-[10px] text-slate-400 font-mono w-10">${Math.round(testerWipUsage)}%</span>
                        </div>
                        <div class="text-[10px] text-slate-400 pt-0.5"><span class="font-bold">${activeDevsCount}</span> Devs · <span class="font-bold">${activeTestersCount}</span> Testers</div>
                    </div>
                    <div class="p-10 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-8 pointer-events-none">
                        <div class="space-y-6">
                            <div class="flex items-center gap-2 pb-2 border-b-2 border-google-blue/30"><i class="fas fa-code text-google-blue"></i><h3 class="text-slate-800 font-black text-sm uppercase">Active Developers</h3></div>
                            ${this.generateStaffBarsWithCount(data.developers, 'google-blue', MAX_HOURS, data.activeDevStories)}
                        </div>
                        <div class="space-y-6">
                            <div class="flex items-center gap-2 pb-2 border-b-2 border-google-green/30"><i class="fas fa-vial text-google-green"></i><h3 class="text-slate-800 font-black text-sm uppercase">Active Testers</h3></div>
                            ${this.generateStaffBarsWithCount(data.testers, 'google-green', MAX_HOURS, data.activeTesterStories)}
                        </div>
                        <div class="space-y-6">
                            <div>
                                <div class="flex items-center gap-2 pb-2 border-b-2 border-amber-200"><i class="fas fa-headset text-amber-600"></i><h3 class="text-slate-800 font-black text-sm uppercase">Working On Support</h3></div>
                                <div class="space-y-3 mt-3">
                                    ${supportWorkersInArea.length > 0 ? supportWorkersInArea.map(worker => `
                                        <div class="flex items-center justify-between p-3 bg-google-yellow-light rounded-xl border border-amber-200">
                                            <div class="flex items-center gap-3"><div class="w-8 h-8 rounded-full bg-white flex items-center justify-center text-amber-600 font-bold text-xs border border-amber-200">${escapeHtml(worker.charAt(0))}</div><div><div class="text-xs font-bold text-slate-700">${escapeHtml(worker)}</div><div class="text-[9px] text-amber-600 uppercase font-bold">Support</div></div></div>
                                            <span class="text-[10px] bg-amber-200 text-amber-800 px-2 py-0.5 rounded-full font-bold">Active</span>
                                        </div>
                                    `).join('') : '<div class="text-slate-400 text-xs italic p-4 text-center">No active support</div>'}
                                </div>
                            </div>
                            <div>
                                <div class="flex items-center gap-2 pb-2 border-b-2 border-rose-200"><i class="fas fa-bug text-rose-600"></i><h3 class="text-slate-800 font-black text-sm uppercase">Working On Bugs</h3></div>
                                <div class="space-y-3 mt-3">
                                    ${bugWorkersInArea.length > 0 ? bugWorkersInArea.map(worker => `
                                        <div class="flex items-center justify-between p-3 bg-google-red-light rounded-xl border border-rose-200">
                                            <div class="flex items-center gap-3"><div class="w-8 h-8 rounded-full bg-white flex items-center justify-center text-rose-600 font-bold text-xs border border-rose-200">${escapeHtml(worker.charAt(0))}</div><div><div class="text-xs font-bold text-slate-700">${escapeHtml(worker)}</div><div class="text-[9px] text-rose-600 uppercase font-bold">Bugs</div></div></div>
                                            <span class="text-[10px] bg-rose-200 text-rose-800 px-2 py-0.5 rounded-full font-bold">Active</span>
                                        </div>
                                    `).join('') : '<div class="text-slate-400 text-xs italic p-4 text-center">No active bugs</div>'}
                                </div>
                            </div>
                        </div>
                        <div class="bg-slate-50 rounded-3xl p-6 border-2 border-dashed border-slate-200">
                            <div class="flex items-center gap-2 mb-4"><div class="w-8 h-8 rounded-full bg-google-green-light flex items-center justify-center text-google-green"><i class="fas fa-user-check text-xs"></i></div><h3 class="text-slate-800 font-black text-sm uppercase">Available For Tasks</h3></div>
                            <div class="mb-5"><p class="text-[9px] font-bold text-google-blue uppercase mb-2 tracking-widest flex items-center gap-2"><i class="fas fa-code text-[10px]"></i> Developers</p><div class="flex flex-wrap gap-2">${finalAvailableDevs.length > 0 ? finalAvailableDevs.map(name => renderAvailableTag(name)).join('') : '<span class="text-[10px] text-slate-300 italic">No available developers</span>'}</div></div>
                            <div><p class="text-[9px] font-bold text-purple-600 uppercase mb-2 tracking-widest flex items-center gap-2"><i class="fas fa-vial text-[10px]"></i> Testers</p><div class="flex flex-wrap gap-2">${availableTesters.length > 0 ? availableTesters.map(name => renderAvailableTag(name)).join('') : '<span class="text-[10px] text-slate-300 italic">No available testers</span>'}</div></div>
                        </div>
                    </div>
                </div>
            `;
        }).join('');
        const activeTab = document.querySelector('.tab-content.active');
        if (activeTab && activeTab.id === 'tab-workload') {
            const allFreeDevs = [];
            areaEntries.forEach(([areaName, data]) => {
                const freeDevsInArea = [...data.allDevsInArea].filter(name => !data.developers[name]).filter(name => !supportWorkersGlobal.has(name)).filter(name => !bugWorkersGlobal.has(name)).filter(name => !globalTaskWorkers.has(name)).filter(name => !data.allTestersInArea.has(name));
                if (freeDevsInArea.length > 0) allFreeDevs.push({ area: areaName, devs: freeDevsInArea });
            });
            if (allFreeDevs.length > 0) this.showFreeDevelopersPopup(allFreeDevs);
        }
    },
    generateStaffBarsWithCount(staffData, color, max, storyCounts) {
        const entries = Object.entries(staffData);
        if (entries.length === 0) return `<div class="text-gray-300 text-sm italic">No active tasks</div>`;
        return entries.sort((a, b) => b[1] - a[1]).map(([name, hours]) => {
            const perc = Math.min((hours / max) * 100, 100);
            const isOver = hours > max;
            const barColor = isOver ? 'bg-google-red' : (perc > 80 ? 'bg-google-yellow' : `bg-${color}`);
            const storyCount = storyCounts[name] || 0;
            return `
                <div class="relative p-3 bg-slate-50/50 rounded-2xl border border-slate-100 hover:bg-slate-50 transition-colors">
                    <div class="flex justify-between mb-2 items-start">
                        <span class="font-bold text-sm text-slate-700">${escapeHtml(name)} <span class="text-[10px] font-normal text-gray-400">(${storyCount} ${storyCount === 1 ? 'story' : 'stories'})</span></span>
                        <span class="text-xs font-mono ${isOver ? 'text-google-red font-black' : 'text-slate-500'}">${hours.toFixed(1)} <span class="text-[10px] text-slate-400">/ ${max}h</span></span>
                    </div>
                    <div class="w-full bg-gray-200/70 rounded-full h-2"><div class="${barColor} h-2 rounded-full transition-all duration-1000 shadow-sm" style="width: ${perc}%"></div></div>
                </div>
            `;
        }).join('');
    },
    showFreeDevelopersPopup(freeDevsByArea) {
        let modal = document.getElementById('free-devs-modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'free-devs-modal';
            modal.className = 'fixed inset-0 bg-black/50 flex items-center justify-center z-[1000]';
            modal.innerHTML = `
                <div class="bg-white rounded-2xl shadow-2xl max-w-2xl w-full mx-4 max-h-[80vh] overflow-hidden flex flex-col">
                    <div class="flex justify-between items-center p-4 border-b">
                        <h3 class="text-lg font-bold text-slate-800">🟢 Available Developers (Completely Free)</h3>
                        <button onclick="document.getElementById('free-devs-modal').style.display='none'" class="text-slate-500 hover:text-google-red text-2xl font-bold leading-none">&times;</button>
                    </div>
                    <div class="p-4 overflow-y-auto" id="free-devs-content"></div>
                </div>
            `;
            document.body.appendChild(modal);
        }
        const content = document.getElementById('free-devs-content');
        if (!freeDevsByArea || freeDevsByArea.length === 0) {
            content.innerHTML = '<p class="text-gray-400 text-center py-8">No completely free developers at the moment.</p>';
        } else {
            content.innerHTML = freeDevsByArea.map(item => `
                <div class="mb-4">
                    <h4 class="font-bold text-google-blue text-sm border-b pb-1 mb-2">${escapeHtml(item.area)}</h4>
                    <div class="flex flex-wrap gap-2">${item.devs.map(name => `<span class="px-3 py-1 bg-google-green-light text-google-green rounded-full text-xs font-bold border border-google-green/30">${escapeHtml(name)}</span>`).join('')}</div>
                </div>
            `).join('');
        }
        modal.style.display = 'flex';
    },
    handleAreaDragStart(event, index) {
        event.dataTransfer.setData('text/plain', index);
        setTimeout(() => event.target.classList.add('opacity-40'), 0);
    },
    handleAreaDragOver(event) {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
    },
    handleAreaDrop(event, targetIndex) {
        event.preventDefault();
        const sourceIndex = parseInt(event.dataTransfer.getData('text/plain'));
        if (sourceIndex === targetIndex) return;
        const currentAreas = Array.from(new Set(currentData.filter(s => !isBacklogStory(s)).map(s => s.area || "General Business Area")));
        const movedAreaName = currentAreas.splice(sourceIndex, 1)[0];
        currentAreas.splice(targetIndex, 0, movedAreaName);
        const nonBacklog = currentData.filter(s => !isBacklogStory(s));
        const reorderedData = [];
        currentAreas.forEach(areaName => {
            const storiesInArea = nonBacklog.filter(s => (s.area || "General Business Area") === areaName);
            reorderedData.push(...storiesInArea);
        });
        const backlogStories = currentData.filter(s => isBacklogStory(s));
        currentData = [...reorderedData, ...backlogStories];
        this.renderWorkload();
    },
    openStoryModal(storyId) {
        const s = currentData.find(item => item.id.toString() === storyId.toString());
        if (!s) return;
        const modal = document.getElementById('story-modal');
        const title = document.getElementById('modal-title');
        const body = document.getElementById('modal-body');
        title.innerText = `[#${s.id}] ${s.title}`;
        if (isBacklogStory(s)) {
            body.innerHTML = `
                <div class="grid grid-cols-2 gap-4 text-sm">
                    <div class="bg-slate-50 p-3 rounded-lg"><p class="text-gray-500 text-xs font-bold uppercase">Business Area</p><p class="font-semibold text-slate-700">${escapeHtml(s.area)}</p></div>
                    <div class="bg-slate-50 p-3 rounded-lg"><p class="text-gray-500 text-xs font-bold uppercase">Priority</p><p class="font-semibold text-slate-700">P${escapeHtml(s.priority)}</p></div>
                </div>
                <div class="bg-purple-50 p-4 rounded-xl border border-purple-200">
                    <div class="flex items-center gap-2 text-purple-700"><span class="text-lg">📋</span><span class="font-bold">This story is in the Backlog</span></div>
                    <p class="text-sm text-slate-600 mt-2">State: ${escapeHtml(s.state)}</p>
                    ${s.expectedRelease ? `<p class="text-sm text-slate-600">Expected Release: ${escapeHtml(s.expectedRelease.toLocaleDateString('en-GB'))}</p>` : ''}
                    ${s.assignedTo ? `<p class="text-sm text-slate-600">Assigned To: ${escapeHtml(s.assignedTo)}</p>` : ''}
                </div>
                <div class="mt-6 p-4 bg-google-blue-light rounded-xl border border-google-blue/30">
                    <div class="flex justify-between items-center"><span class="text-xs font-bold text-slate-500 uppercase">Client Release Date</span><span class="text-sm font-bold text-slate-700">${s.expectedRelease instanceof Date ? escapeHtml(s.expectedRelease.toLocaleDateString()) : 'Not Scheduled'}</span></div>
                </div>
            `;
        } else {
            const nonTestTasks = s.tasks.filter(t => t['Activity'] !== 'Testing' && t['Activity'] !== 'Preparation');
            body.innerHTML = `
                <div class="grid grid-cols-2 gap-4 text-sm">
                    <div class="bg-slate-50 p-3 rounded-lg"><p class="text-gray-500 text-xs font-bold uppercase">Business Area</p><p class="font-semibold text-slate-700">${escapeHtml(s.area)}</p></div>
                    <div class="bg-slate-50 p-3 rounded-lg"><p class="text-gray-500 text-xs font-bold uppercase">Priority</p><p class="font-semibold text-slate-700">P${escapeHtml(s.priority)}</p></div>
                </div>
                <div class="space-y-4">
                    <h4 class="font-bold text-google-blue border-b pb-1">🛠 Development Details</h4>
                    <div class="grid grid-cols-2 gap-2 text-xs"><p><b>Assigned To:</b> ${escapeHtml(s.assignedTo)}</p><p><b>Dev End:</b> ${s.calc.devEnd instanceof Date ? escapeHtml(s.calc.devEnd.toLocaleString()) : 'TBD'}</p></div>
                    <div class="space-y-1">${nonTestTasks.map(t => `
                        <div class="flex justify-between text-[11px] bg-white border p-2 rounded shadow-sm">
                            <span class="flex items-start gap-2"><span class="font-mono text-google-blue font-bold bg-google-blue-light px-1 rounded">#${escapeHtml(t['ID'])}</span><span>${escapeHtml(t['Title'])}</span></span>
                            <span class="px-2 rounded h-fit ${t['State'] === 'Closed' ? 'bg-google-green-light text-google-green' : 'bg-google-yellow-light text-amber-700'}">${escapeHtml(t['State'])}</span>
                        </div>
                    `).join('')}</div>
                </div>
                <div class="space-y-4">
                    <h4 class="font-bold text-purple-700 border-b pb-1">🔍 QA & Testing</h4>
                    <div class="grid grid-cols-2 gap-2 text-xs"><p><b>Tester:</b> ${escapeHtml(s.tester)}</p><p><b>Test End:</b> ${s.calc.testEnd instanceof Date ? escapeHtml(s.calc.testEnd.toLocaleString()) : 'Waiting'}</p></div>
                    <div class="space-y-1">${s.testCases && s.testCases.length > 0 ? s.testCases.map(tc => `
                        <div class="flex justify-between text-[11px] bg-white border p-2 rounded shadow-sm">
                            <span>TC #${escapeHtml(tc.id)}</span>
                            <span class="font-bold ${tc.state === 'Pass' ? 'text-google-green' : 'text-google-red'}">${escapeHtml(tc.state)}</span>
                        </div>
                    `).join('') : '<p class="text-xs text-gray-400 italic">No test cases linked yet.</p>'}</div>
                </div>
                ${s.bugs && s.bugs.length > 0 ? `
                <div class="space-y-2">
                    <h4 class="font-bold text-google-red border-b pb-1">🐞 Bugs (${s.bugs.length})</h4>
                    ${s.bugs.map(b => `
                        <div class="text-[11px] border-l-2 border-google-red pl-2 py-1">
                            <p class="font-bold">${escapeHtml(b['Title'])}</p>
                            <p class="text-gray-500">State: ${escapeHtml(b['State'])} | Effort: ${escapeHtml(b['Original Estimation'])}h</p>
                        </div>
                    `).join('')}
                </div>` : ''}
                <div class="mt-6 p-4 bg-google-blue-light rounded-xl border border-google-blue/30">
                    <div class="flex justify-between items-center mb-2"><span class="text-xs font-bold text-google-blue uppercase">Internal Delivery Target</span><span class="text-sm font-bold text-google-blue">${s.calc.finalEnd instanceof Date ? escapeHtml(s.calc.finalEnd.toLocaleString()) : 'Calculating...'}</span></div>
                    <div class="flex justify-between items-center"><span class="text-xs font-bold text-slate-500 uppercase">Client Release Date</span><span class="text-sm font-bold text-slate-700">${s.expectedRelease instanceof Date ? escapeHtml(s.expectedRelease.toLocaleDateString()) : 'Not Scheduled'}</span></div>
                </div>
            `;
        }
        modal.classList.remove('hidden');
        document.body.style.overflow = 'hidden';
    },
    closeModal() {
        document.getElementById('story-modal').classList.add('hidden');
        document.body.style.overflow = 'auto';
    },
    openCommentsModal(storyId) {
        const s = currentData.find(item => item.id.toString() === storyId.toString());
        if (!s) return;
        const modal = document.getElementById('story-modal');
        const title = document.getElementById('modal-title');
        const body = document.getElementById('modal-body');
        title.innerText = `[#${s.id}] Standup Updates`;
        const comments = getStandupComments(s.id);
        body.innerHTML = `
            <div class="bg-slate-50/30 px-2">
                <div class="flex gap-2 mb-4">
                    <input type="text" id="kanban-comment-input" placeholder="Add new update and press Enter..." class="form-input flex-1" onkeypress="if(event.key === 'Enter') { commentManager.updateComment('${s.id}', this.value); this.value=''; ui.openCommentsModal('${s.id}'); ui.renderKanban(); }">
                </div>
                <div class="space-y-3 max-h-[60vh] overflow-y-auto pr-2">
                    ${comments.slice().reverse().map(c => `
                        <div class="bg-white p-3 rounded-xl border border-google-blue/20 shadow-sm">
                            <div class="flex justify-between items-center mb-2"><span class="text-[10px] font-bold text-google-blue bg-google-blue-light px-2 py-1 rounded">${escapeHtml(c.date)}</span></div>
                            <p class="text-sm text-slate-700 leading-relaxed italic">"${escapeHtml(c.text)}"</p>
                        </div>
                    `).join('')}
                    ${comments.length === 0 ? '<div class="text-center p-6 text-gray-400 italic text-sm">No updates recorded yet.</div>' : ''}
                </div>
            </div>
        `;
        modal.classList.remove('hidden');
        document.body.style.overflow = 'hidden';
        setTimeout(() => {
            const input = document.getElementById('kanban-comment-input');
            if (input) input.focus();
        }, 100);
    },
    showModalWithTitleAndStories(title, stories) {
        const modal = document.getElementById('story-modal');
        const titleEl = document.getElementById('modal-title');
        const body = document.getElementById('modal-body');
        titleEl.innerText = title;
        const grouped = stories.reduce((acc, s) => {
            const area = s.area || "General";
            if (!acc[area]) acc[area] = [];
            acc[area].push(s);
            return acc;
        }, {});
        let html = '<div class="space-y-4">';
        for (const area in grouped) {
            html += `<div class="border-b pb-2"><h4 class="font-bold text-google-blue">${escapeHtml(area)}</h4>`;
            grouped[area].forEach(s => {
                html += `
                    <div class="flex justify-between items-center border-b border-gray-100 py-1 hover:bg-gray-50 cursor-pointer" onclick="ui.openStoryModal('${s.id}')">
                        <span class="text-sm">#${s.id} - ${escapeHtml(s.title)}</span>
                        <span class="status-badge ${s.state === 'Tested' ? 'status-tested' : 'status-active'}">${escapeHtml(s.state)}</span>
                    </div>
                `;
            });
            html += '</div>';
        }
        html += '</div>';
        body.innerHTML = html;
        modal.classList.remove('hidden');
        document.body.style.overflow = 'hidden';
    },
    showBranchModal(branch) {
        const nonBacklog = currentData.filter(s => !isBacklogStory(s) && isRegularStory(s));
        const activeStories = nonBacklog.filter(s => s.branch === branch && s.state !== 'Tested' && s.state !== 'Closed');
        this.showModalWithTitleAndStories(`Branch: ${escapeHtml(branch)} (${activeStories.length} active stories)`, activeStories);
    },
    showCustomerModal(customer) {
        const nonBacklog = currentData.filter(s => !isBacklogStory(s) && isRegularStory(s));
        const activeStories = nonBacklog.filter(s => s.customer === customer && s.state !== 'Tested' && s.state !== 'Closed');
        this.showModalWithTitleAndStories(`Customer: ${escapeHtml(customer)} (${activeStories.length} active stories)`, activeStories);
    },
    renderDailyActivity() {
        const container = document.getElementById('daily-activity-container');
        if (!container) return;
        const today = new Date();
        const todayStr = today.toISOString().split('T')[0];
        const activities = [];
        const nonBacklog = currentData.filter(s => !isBacklogStory(s) && isRegularStory(s));
        nonBacklog.forEach(story => {
            let hasActivityToday = false;
            const storyDate = story.changedDate ? new Date(story.changedDate).toISOString().split('T')[0] : null;
            if (storyDate === todayStr) hasActivityToday = true;
            if (story.tasks && story.tasks.length > 0) {
                const taskChangedToday = story.tasks.some(task => {
                    if (!task['Changed Date']) return false;
                    const taskDate = new Date(task['Changed Date']).toISOString().split('T')[0];
                    return taskDate === todayStr;
                });
                if (taskChangedToday) hasActivityToday = true;
            }
            if (hasActivityToday) activities.push(story);
        });
        if (activities.length === 0) {
            container.innerHTML = `<div class="bg-white p-10 rounded-xl border-2 border-dashed border-gray-200 text-center text-gray-400">No updates recorded for today (${escapeHtml(todayStr)})</div>`;
            return;
        }
        const grouped = activities.reduce((acc, item) => {
            const branch = item.branch || "N/A";
            const area = item.area || "General";
            const customer = item.customer || "General";
            if (!acc[branch]) acc[branch] = {};
            if (!acc[branch][area]) acc[branch][area] = {};
            if (!acc[branch][area][customer]) acc[branch][area][customer] = [];
            acc[branch][area][customer].push(item);
            return acc;
        }, {});
        let html = this.renderDailyActivitySummary(activities, grouped);
        html += `<div class="space-y-6 mt-6">`;
        for (const branch in grouped) {
            const branchItemsCount = Object.values(grouped[branch]).reduce((sum, area) => sum + Object.values(area).reduce((s, cust) => s + cust.length, 0), 0);
            html += `
            <div class="card overflow-hidden">
                <div class="bg-slate-50 px-4 py-2 border-b border-slate-200 flex justify-between items-center">
                    <span class="font-bold text-slate-700 text-sm"><i class="fas fa-code-branch mr-2 text-google-blue"></i>${escapeHtml(branch)}</span>
                    <span class="bg-google-blue text-white text-[10px] px-2 py-0.5 rounded-full font-bold">${branchItemsCount} Today</span>
                </div>
                <div class="p-4 space-y-4">`;
            for (const area in grouped[branch]) {
                html += `<div><h4 class="text-xs font-black text-google-blue mb-2 uppercase tracking-tighter italic underline">${escapeHtml(area)}</h4>`;
                for (const customer in grouped[branch][area]) {
                    html += `<div class="ml-2 mb-3"><div class="text-[11px] font-bold text-slate-400 mb-2 border-l-2 border-slate-200 pl-2 tracking-widest uppercase">Target: ${escapeHtml(customer)}</div>`;
                    grouped[branch][area][customer].forEach(story => {
                        html += this.renderStoryCard(story);
                    });
                    html += `</div>`;
                }
                html += `</div>`;
            }
            html += `</div></div>`;
        }
        html += `</div>`;
        container.innerHTML = html;
    },
    renderDailyActivitySummary(activities, grouped) {
        const total = activities.length;
        const states = activities.reduce((acc, s) => { acc[s.state] = (acc[s.state] || 0) + 1; return acc; }, {});
        const branchStatsMap = {};
        activities.forEach(s => {
            const branchName = s.branch || "Unknown";
            branchStatsMap[branchName] = (branchStatsMap[branchName] || 0) + 1;
        });
        const branchStats = Object.entries(branchStatsMap).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
        const areaStatsMap = {};
        activities.forEach(s => {
            const areaName = s.area || "General";
            areaStatsMap[areaName] = (areaStatsMap[areaName] || 0) + 1;
        });
        const areaStats = Object.entries(areaStatsMap).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
        // UPDATED: Light background for Total Daily Activities
        return `
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
            <div class="bg-gradient-to-br from-blue-100 to-blue-200 p-5 rounded-2xl shadow-lg text-slate-800">
                <div class="text-[10px] opacity-80 font-bold uppercase tracking-widest text-center">Total Daily Activities</div>
                <div class="text-5xl font-black mt-2 text-center">${total}</div>
                <div class="text-[10px] mt-3 bg-white/50 text-center px-2 py-1 rounded-md">Matching all charts below</div>
            </div>
            <div class="col-span-1 md:col-span-2 bg-white p-4 rounded-2xl shadow-sm border border-slate-100">
                <div class="text-[10px] text-gray-400 font-bold uppercase mb-3">Status Breakdown</div>
                <div class="flex flex-wrap gap-2">${Object.entries(states).map(([state, count]) => `
                    <div class="bg-slate-50 px-3 py-2 rounded-xl border border-slate-100 flex-1 min-w-[100px]">
                        <div class="text-[9px] font-bold text-slate-500 truncate">${escapeHtml(state)}</div>
                        <div class="text-lg font-black text-google-blue">${count}</div>
                    </div>
                `).join('')}</div>
            </div>
        </div>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
            <div class="bg-white p-4 rounded-2xl shadow-sm border border-slate-100">
                <div class="text-[10px] text-google-blue font-bold uppercase mb-2 flex justify-between"><span>📊 Branches Summary</span><span>Sum: ${branchStats.reduce((a, b) => a + b.count, 0)}</span></div>
                <div class="space-y-3 mt-2">${branchStats.slice(0, 5).map(branch => {
                    const width = (branch.count / total) * 100;
                    return `<div><div class="flex justify-between text-[10px] mb-1 font-bold text-slate-600"><span class="truncate pr-2">${escapeHtml(branch.name)}</span><span>${branch.count}</span></div><div class="w-full bg-slate-100 h-1.5 rounded-full overflow-hidden"><div class="bg-google-blue h-full rounded-full" style="width: ${width}%"></div></div></div>`;
                }).join('')}</div>
            </div>
            <div class="bg-white p-4 rounded-2xl shadow-sm border border-slate-100">
                <div class="text-[10px] text-purple-600 font-bold uppercase mb-2 flex justify-between"><span>📂 Areas Summary</span><span>Sum: ${areaStats.reduce((a, b) => a + b.count, 0)}</span></div>
                <div class="space-y-3 mt-2">${areaStats.slice(0, 5).map(area => {
                    const width = (area.count / total) * 100;
                    return `<div><div class="flex justify-between text-[10px] mb-1 font-bold text-slate-600"><span class="truncate pr-2">${escapeHtml(area.name)}</span><span>${area.count}</span></div><div class="w-full bg-slate-100 h-1.5 rounded-full overflow-hidden"><div class="bg-purple-500 h-full rounded-full" style="width: ${width}%"></div></div></div>`;
                }).join('')}</div>
            </div>
        </div>
        `;
    },
    renderStoryCard(s) {
        const isLate = s.calc.finalEnd instanceof Date && new Date() > s.calc.finalEnd;
        let statusColor = isLate ? "status-delayed" : "status-active";
        return `
        <div onclick="ui.openStoryModal('${s.id}')" class="group p-3 mb-2 bg-slate-50 border border-slate-100 rounded-xl hover:border-google-blue hover:bg-white transition-all cursor-pointer">
            <div class="flex justify-between items-start mb-2">
                <span class="status-badge ${statusColor}">${escapeHtml(s.state)}</span>
                <span class="text-[9px] text-slate-400 font-mono">#${s.id}</span>
            </div>
            <h5 class="text-xs font-bold text-slate-800 group-hover:text-google-blue transition-colors line-clamp-1">${escapeHtml(s.title)}</h5>
            <div class="flex items-center gap-4 mt-2">
                <div class="flex items-center gap-1"><span class="text-[9px] text-slate-400 font-bold uppercase tracking-tighter">Dev:</span><span class="text-[10px] font-medium text-slate-600">${escapeHtml(s.assignedTo)}</span></div>
                <div class="flex items-center gap-1"><span class="text-[9px] text-slate-400 font-bold uppercase tracking-tighter">Testing:</span><span class="text-[10px] font-medium text-slate-600">${escapeHtml(s.tester)}</span></div>
            </div>
        </div>`;
    },
    exportDailyActivityToExcel() {
        const todayStr = new Date().toISOString().split('T')[0];
        const activities = [];
        const nonBacklog = currentData.filter(s => !isBacklogStory(s) && isRegularStory(s));
        nonBacklog.forEach(story => {
            let hasActivityToday = false;
            const storyDate = story.changedDate ? new Date(story.changedDate).toISOString().split('T')[0] : null;
            if (storyDate === todayStr) hasActivityToday = true;
            if (story.tasks && story.tasks.length > 0) {
                const taskChangedToday = story.tasks.some(task => {
                    if (!task['Changed Date']) return false;
                    const taskDate = new Date(task['Changed Date']).toISOString().split('T')[0];
                    return taskDate === todayStr;
                });
                if (taskChangedToday) hasActivityToday = true;
            }
            if (hasActivityToday) activities.push({
                id: story.id,
                title: story.title,
                branch: story.branch || "N/A",
                area: story.area || "General",
                customer: story.customer || "General",
                state: story.state,
                assignedTo: story.assignedTo
            });
        });
        if (activities.length === 0) return ui.showToast("لا توجد أنشطة مسجلة بتاريخ اليوم لتصديرها", "error");
        const grouped = activities.reduce((acc, item) => {
            if (!acc[item.branch]) acc[item.branch] = {};
            if (!acc[item.branch][item.area]) acc[item.branch][item.area] = {};
            if (!acc[item.branch][item.area][item.customer]) acc[item.branch][item.area][item.customer] = [];
            acc[item.branch][item.area][item.customer].push(item);
            return acc;
        }, {});
        let csvContent = "\uFEFF";
        csvContent += "Level,Identifier,Details/Title,Owner,Status\n";
        for (const branch in grouped) {
            let branchCount = 0;
            Object.values(grouped[branch]).forEach(area => Object.values(area).forEach(cust => branchCount += cust.length));
            csvContent += `BRANCH,${branch},Total Items: ${branchCount},,\n`;
            for (const area in grouped[branch]) {
                let areaCount = 0;
                Object.values(grouped[branch][area]).forEach(cust => areaCount += cust.length);
                csvContent += `AREA,${area},Sub-total: ${areaCount},,\n`;
                for (const customer in grouped[branch][area]) {
                    const customerStories = grouped[branch][area][customer];
                    csvContent += `CUSTOMER,${customer},Items: ${customerStories.length},,\n`;
                    customerStories.forEach(s => {
                        csvContent += `STORY,#${s.id},"${s.title.replace(/"/g, '""')}",${s.assignedTo},${s.state}\n`;
                    });
                }
            }
            csvContent += ",,,,\n";
        }
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement("a");
        const url = URL.createObjectURL(blob);
        link.setAttribute("href", url);
        link.setAttribute("download", `Daily_Report_${todayStr}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    },
    renderInactiveStories() {
        const container = document.getElementById('inactive-stories-container');
        if (!container) return;
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const nonBacklog = currentData.filter(s => !isBacklogStory(s) && isRegularStory(s));
        const inactive = nonBacklog.filter(s => {
            const isActive = s.state !== 'Tested' && s.state !== 'Closed';
            const lastChange = s.changedDate ? new Date(s.changedDate) : null;
            return isActive && (!lastChange || lastChange < today);
        });
        if (inactive.length === 0) {
            container.innerHTML = `<div class="col-span-full text-center py-10 text-gray-400">All active stories have been updated today! 🎉</div>`;
            return;
        }
        const groupedByArea = inactive.reduce((groups, story) => {
            const areaName = story.area || "General";
            if (!groups[areaName]) groups[areaName] = [];
            groups[areaName].push(story);
            return groups;
        }, {});
        let html = '';
        const now = new Date();
        for (const area in groupedByArea) {
            html += `
                <div class="col-span-full mt-8 mb-4">
                    <div class="flex items-center gap-3">
                        <h3 class="text-xl font-extrabold text-slate-800">${escapeHtml(area)}</h3>
                        <span class="px-3 py-1 bg-google-blue-light text-google-blue rounded-full text-xs font-bold">${groupedByArea[area].length} Stories</span>
                        <div class="flex-grow h-px bg-slate-200"></div>
                    </div>
                </div>
            `;
            groupedByArea[area].forEach(s => {
                const lastAction = s.changedDate ? new Date(s.changedDate) : now;
                const diffDays = Math.floor(Math.abs(now - lastAction) / (1000 * 60 * 60 * 24));
                let dayColorClass = "text-google-green border-google-green/30 bg-google-green-light";
                if (diffDays > 1 && diffDays <= 3) dayColorClass = "text-amber-500 border-amber-200 bg-google-yellow-light";
                else if (diffDays > 3) dayColorClass = "text-google-red border-google-red/30 bg-google-red-light";
                html += `
                    <div class="col-span-full lg:col-span-1 bg-white p-5 rounded-2xl border border-slate-100 shadow-sm hover:shadow-md transition-all cursor-pointer flex items-center gap-5" onclick="ui.openStoryModal('${s.id}')">
                        <div class="flex flex-col items-center justify-center min-w-[80px] h-[80px] rounded-2xl border-2 ${dayColorClass}">
                            <span class="text-3xl font-black leading-none">${diffDays}</span>
                            <span class="text-[9px] font-bold uppercase mt-1">Days</span>
                        </div>
                        <div class="flex-grow min-w-0">
                            <div class="flex items-center gap-2 mb-1">
                                <span class="text-[10px] font-bold text-slate-400">#${s.id}</span>
                                <span class="px-2 py-0.5 bg-slate-100 text-[9px] font-bold rounded uppercase text-slate-500">${escapeHtml(s.state)}</span>
                                <span class="ml-auto font-bold text-google-blue text-[10px]">P${escapeHtml(s.priority)}</span>
                            </div>
                            <h3 class="font-bold text-slate-800 text-sm mb-1 truncate" title="${escapeHtml(s.title)}">${escapeHtml(s.title)}</h3>
                            <div class="flex flex-wrap gap-1 mb-2">${(s.tags || []).map(t => `<span class="px-2 py-0.5 bg-google-red-light text-google-red border border-google-red/30 rounded text-[9px] font-semibold">${escapeHtml(t)}</span>`).join('')}</div>
                            <div class="flex flex-wrap gap-y-1 gap-x-4">
                                <div class="flex items-center gap-1 text-[11px] text-slate-500"><span class="font-semibold text-slate-700">Dev:</span> ${escapeHtml(s.assignedTo || '---')}</div>
                                <div class="flex items-center gap-1 text-[11px] text-slate-500"><span class="font-semibold text-slate-700">QA:</span> ${escapeHtml(s.tester || '---')}</div>
                                <div class="flex items-center gap-1 text-[11px] text-google-red"><span class="font-semibold">Last:</span> ${s.changedDate ? escapeHtml(new Date(s.changedDate).toLocaleDateString('en-GB')) : 'N/A'}</div>
                            </div>
                        </div>
                    </div>
                `;
            });
        }
        container.innerHTML = `<div class="grid grid-cols-1 xl:grid-cols-2 gap-4">${html}</div>`;
    },
    renderSettings() {
        const nonBacklog = currentData.filter(s => !isBacklogStory(s) && isRegularStory(s));
        const staff = [...new Set(nonBacklog.map(s => s.assignedTo).concat(nonBacklog.map(s => s.tester)))];
        const staffSelect = document.getElementById('staff-select');
        if (staffSelect) staffSelect.innerHTML = staff.map(s => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join('');
        document.getElementById('vacations-list').innerHTML = db.vacations.map((v, i) => `
            <div class="flex justify-between bg-gray-50 p-1 px-2 rounded mb-1"><span>${escapeHtml(v.name)} - ${escapeHtml(v.date)}</span><button onclick="settings.removeVacation(${i})" class="text-google-red">×</button></div>
        `).join('');
        document.getElementById('holidays-list').innerHTML = db.holidays.map((h, i) => `
            <span class="bg-gray-200 px-2 py-1 rounded text-xs inline-flex items-center gap-1 m-1">${escapeHtml(h)} <button onclick="settings.removeHoliday(${i})" class="text-google-red">×</button></span>
        `).join('');
        const usersList = document.getElementById('users-list');
        if (usersList) {
            usersList.innerHTML = db.users.map((u, i) => `
                <div class="flex justify-between items-center bg-gray-50 p-2 rounded border">
                    <div><span class="font-bold text-slate-700">${escapeHtml(u.username)}</span><span class="text-[10px] ml-2 px-2 py-0.5 rounded-full ${u.role === 'admin' ? 'bg-google-red-light text-google-red' : 'bg-google-blue-light text-google-blue'}">${escapeHtml(u.role)}</span></div>
                    <button onclick="settings.removeUser(${i})" class="text-google-red hover:text-red-700 font-bold text-xl">&times;</button>
                </div>
            `).join('');
        }
        tagManager.renderTagsSettings();

        const projectsList = document.getElementById('projects-list');
        if (projectsList) {
            projectsList.innerHTML = db.projects.map(p => `
                <div class="flex justify-between items-center bg-gray-50 p-2 rounded border">
                    <div>
                        <span class="font-bold text-slate-700">${escapeHtml(p.name)}</span>
                        <span class="text-xs ml-2 px-2 py-0.5 rounded-full ${p.status === 'active' ? 'bg-google-green-light text-google-green' : p.status === 'hold' ? 'bg-google-yellow-light text-amber-600' : 'bg-gray-200 text-gray-500'}">${escapeHtml(p.status)}</span>
                        <span class="text-xs text-gray-400 ml-2">Team: ${escapeHtml(p.team)}</span>
                    </div>
                    <button onclick="projectManager.deleteProject('${p.id}')" class="text-google-red hover:text-red-700 font-bold text-xl">&times;</button>
                </div>
            `).join('');
        }
    },
    renderAuditorChecklist() {
        const tbody = document.getElementById('auditor-table-body');
        if (!tbody) return;
        const areaFilter = document.getElementById('auditor-area-filter')?.value || 'all';
        const stateFilter = document.getElementById('auditor-state-filter')?.value || 'all';
        const areaSelect = document.getElementById('auditor-area-filter');
        const nonBacklog = currentData.filter(s => !isBacklogStory(s) && isRegularStory(s));
        if (areaSelect && areaSelect.options.length <= 1) {
            const areas = [...new Set(nonBacklog.map(s => s.area || "General"))];
            areaSelect.innerHTML = '<option value="all">All Areas</option>' + areas.map(a => `<option value="${escapeHtml(a)}">${escapeHtml(a)}</option>`).join('');
        }
        let filtered = nonBacklog;
        if (areaFilter !== 'all') filtered = filtered.filter(s => (s.area || "General") === areaFilter);
        if (stateFilter !== 'all') filtered = filtered.filter(s => s.state === stateFilter);
        if (filtered.length === 0) {
            tbody.innerHTML = `<tr><td colspan="10" class="text-center py-8 text-gray-400">No stories match the selected filters.</td></tr>`;
            return;
        }
        const rowsHtml = filtered.map(story => {
            const criteria = this.evaluateStoryCompliance(story);
            const compliancePercent = Math.round((criteria.passedCount / criteria.totalCount) * 100);
            let barColor = 'bg-google-red';
            if (compliancePercent >= 80) barColor = 'bg-google-green';
            else if (compliancePercent >= 50) barColor = 'bg-google-yellow';
            return `
                <tr class="border-b hover:bg-gray-50 transition">
                    <td class="px-4 py-3 font-mono text-xs">#${story.id}</td>
                    <td class="px-4 py-3 font-medium text-slate-700 max-w-xs truncate" title="${escapeHtml(story.title)}">${escapeHtml(story.title)}</td>
                    <td class="px-4 py-3"><span class="status-badge status-active">${escapeHtml(story.state)}</span></td>
                    <td class="px-4 py-3 text-center">
                        <div class="flex flex-col items-center gap-1">
                            <span class="text-xs font-bold">${compliancePercent}%</span>
                            <div class="w-full bg-gray-200 rounded-full h-2 max-w-[80px]"><div class="${barColor} h-2 rounded-full" style="width: ${compliancePercent}%"></div></div>
                        </div>
                    </td>
                    <td class="px-4 py-3 text-center">${criteria.priority ? '✅' : '❌'}</td>
                    <td class="px-4 py-3 text-center">${criteria.iterationPath ? '✅' : '❌'}</td>
                    <td class="px-4 py-3 text-center">${criteria.devTasks ? '✅' : '❌'}</td>
                    <td class="px-4 py-3 text-center">${criteria.testTasks ? '✅' : '❌'}</td>
                    <td class="px-4 py-3 text-center">${criteria.testCasesPass ? '✅' : '❌'}</td>
                    <td class="px-4 py-3 text-center">${criteria.bugsClosed ? '✅' : '❌'}</td>
                    <td class="px-4 py-3 text-center">${criteria.reviewsClosed ? '✅' : '❌'}</td>
                </tr>
            `;
        }).join('');
        tbody.innerHTML = rowsHtml;
    },
    evaluateStoryCompliance(story) {
        let passedCount = 0;
        const totalCount = 7;
        const priorityValid = story.priority && story.priority !== 999 && !isNaN(story.priority);
        if (priorityValid) passedCount++;
        const iterationPathValid = story.iterationPath && /[\d\/]/.test(story.iterationPath);
        if (iterationPathValid) passedCount++;
        const devTasksList = story.tasks.filter(t => ["Development", "DB Modification"].includes(t['Activity']));
        let devTasksValid = devTasksList.length > 0;
        if ((story.state === 'Tested' || story.state === 'Closed') && devTasksValid) {
            const allDevClosed = devTasksList.every(t => ['Closed', 'Resolved'].includes(t['State']));
            devTasksValid = allDevClosed;
        }
        if (devTasksValid) passedCount++;
        const testTasksList = story.tasks.filter(t => t['Activity'] === 'Testing' || (t['Title'] && (t['Title'].toLowerCase().includes('prep') || t['Title'].toLowerCase().includes('preparation'))));
        const testTasksValid = testTasksList.length > 0;
        if (testTasksValid) passedCount++;
        const testCases = story.testCases || [];
        const testCasesValid = testCases.length > 0 && testCases.every(tc => tc.state === 'Pass' || tc.state === 'Not Applicable');
        if (testCasesValid) passedCount++;
        let bugsValid = true;
        if (story.state === 'Tested' || story.state === 'Closed') {
            const bugs = story.bugs || [];
            bugsValid = bugs.length === 0 || bugs.every(b => ['Closed', 'Resolved', 'Cancel'].includes(b['State']));
        }
        if (bugsValid) passedCount++;
        const reviews = story.reviews || [];
        let reviewsValid = true;
        if (reviews.length > 0) reviewsValid = reviews.every(r => ['Closed', 'Resolved'].includes(r.state));
        if (reviewsValid) passedCount++;
        return { passedCount, totalCount, priority: priorityValid, iterationPath: iterationPathValid, devTasks: devTasksValid, testTasks: testTasksValid, testCasesPass: testCasesValid, bugsClosed: bugsValid, reviewsClosed: reviewsValid };
    },
    renderProjectsTab() {
        const container = document.getElementById('projects-container');
        const countSpan = document.getElementById('projects-count');
        if (!container) return;
        const activeProjects = db.projects.filter(p => p.status !== 'closed');
        const closedProjects = db.projects.filter(p => p.status === 'closed');
        const allProjects = [...activeProjects, ...closedProjects];
        countSpan.textContent = `${allProjects.length} projects (${activeProjects.length} active)`;

        if (allProjects.length === 0) {
            container.innerHTML = `<div class="col-span-full text-center py-20 text-gray-400">No projects created yet. Go to Settings to add one.</div>`;
            return;
        }

        const projectsHtml = allProjects.map(p => {
            const statusClass = p.status === 'active' ? 'border-google-green bg-google-green-light' :
                                p.status === 'hold' ? 'border-google-yellow bg-google-yellow-light' : 'border-gray-400 bg-gray-100';
            const statusText = p.status === 'active' ? '🟢 Active' :
                               p.status === 'hold' ? '🟡 On Hold' : '🔴 Closed';
            const storyCount = p.linkedStoryIds ? p.linkedStoryIds.length : 0;
            const taskCount = p.tasks ? p.tasks.length : 0;
            return `
                <div onclick="ui.openProjectDetails('${p.id}')" class="card p-5 border-l-4 ${statusClass} hover:border-google-blue cursor-pointer">
                    <div class="flex justify-between items-start">
                        <h3 class="text-xl font-bold text-slate-800">${escapeHtml(p.name)}</h3>
                        <span class="text-xs font-bold px-2 py-1 rounded-full ${p.status === 'active' ? 'bg-google-green text-white' : p.status === 'hold' ? 'bg-google-yellow text-slate-800' : 'bg-gray-300 text-gray-700'}">${escapeHtml(statusText)}</span>
                    </div>
                    <div class="mt-2 text-sm text-slate-600"><span class="font-bold">Team:</span> ${escapeHtml(p.team)}</div>
                    <div class="text-sm text-slate-600"><span class="font-bold">Due Date:</span> ${escapeHtml(p.dueDate)}</div>
                    <div class="mt-3 flex gap-3 text-xs text-gray-500">
                        <span>📚 Stories: ${storyCount}</span>
                        <span>📋 Tasks: ${taskCount}</span>
                    </div>
                    ${p.status === 'hold' ? `<div class="mt-2 text-xs text-amber-700 bg-google-yellow-light p-2 rounded">⏸ Hold: ${escapeHtml(p.holdReason)} (until ${escapeHtml(p.holdEndDate)})</div>` : ''}
                    ${p.status === 'closed' ? `<div class="mt-2 text-xs text-gray-500">🗓 Closed on: ${escapeHtml(p.closeDate)}</div>` : ''}
                </div>
            `;
        }).join('');

        const sidebarHtml = this.renderTaskDueDateSidebar();

        container.innerHTML = `
            <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div class="lg:col-span-2">
                    <div class="grid grid-cols-1 gap-4">
                        ${projectsHtml}
                    </div>
                </div>
                <div class="lg:col-span-1">
                    ${sidebarHtml}
                </div>
            </div>
        `;
    },
    renderTaskDueDateSidebar() {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);

        const allTasks = [];
        db.projects.forEach(project => {
            (project.tasks || []).forEach(task => {
                if (task.dueDate && task.status !== 'done') {
                    const due = new Date(task.dueDate);
                    due.setHours(0, 0, 0, 0);
                    allTasks.push({
                        projectName: project.name,
                        projectId: project.id,
                        task: task,
                        dueDate: due
                    });
                }
            });
        });

        const overdue = allTasks.filter(t => t.dueDate < today);
        const todayTasks = allTasks.filter(t => t.dueDate.getTime() === today.getTime());
        const tomorrowTasks = allTasks.filter(t => t.dueDate.getTime() === tomorrow.getTime());

        const renderTaskList = (tasks) => {
            if (tasks.length === 0) return `<div class="text-xs text-gray-400 italic">No tasks</div>`;
            return tasks.map(t => `
                <div class="text-xs bg-white p-2 rounded border border-gray-100 mb-1 shadow-sm hover:shadow transition cursor-pointer" 
                     onclick="ui.openProjectDetails('${t.projectId}')">
                    <div class="font-bold text-slate-700 truncate" title="${escapeHtml(t.task.title)}">${escapeHtml(t.task.title)}</div>
                    <div class="text-[10px] text-gray-500">📁 ${escapeHtml(t.projectName)}</div>
                    <div class="text-[10px] text-gray-400">📅 ${escapeHtml(t.task.dueDate)}</div>
                </div>
            `).join('');
        };

        return `
            <div class="card p-4 sticky top-4">
                <h3 class="font-bold text-slate-700 text-lg mb-3 flex items-center gap-2">⏰ Tasks by Due Date</h3>
                <div class="space-y-4">
                    <div>
                        <div class="flex items-center gap-2 text-google-red font-bold text-sm border-b border-google-red/30 pb-1">
                            <span>🔴</span> Overdue (${overdue.length})
                        </div>
                        <div class="mt-2 space-y-1">${renderTaskList(overdue)}</div>
                    </div>
                    <div>
                        <div class="flex items-center gap-2 text-amber-600 font-bold text-sm border-b border-amber-200 pb-1">
                            <span>🟡</span> Today (${todayTasks.length})
                        </div>
                        <div class="mt-2 space-y-1">${renderTaskList(todayTasks)}</div>
                    </div>
                    <div>
                        <div class="flex items-center gap-2 text-google-blue font-bold text-sm border-b border-google-blue/30 pb-1">
                            <span>🔵</span> Tomorrow (${tomorrowTasks.length})
                        </div>
                        <div class="mt-2 space-y-1">${renderTaskList(tomorrowTasks)}</div>
                    </div>
                </div>
            </div>
        `;
    },
    openProjectDetails(projectId) {
        const project = projectManager.getProjectById(projectId);
        if (!project) return;

        const modal = document.getElementById('story-modal');
        const title = document.getElementById('modal-title');
        const body = document.getElementById('modal-body');
        title.innerText = `📁 ${project.name}`;

        let linkedStoriesHtml = '';
        const allStories = [...currentData.filter(s => !isBacklogStory(s) && isRegularStory(s)), ...db.backlogStories];
        const linkedStories = allStories.filter(s => s.linkedProjectId === project.id);
        if (linkedStories.length > 0) {
            linkedStoriesHtml = `
                <div class="space-y-2">
                    <h4 class="font-bold text-google-blue text-sm border-b pb-1">📚 Linked Stories (${linkedStories.length})</h4>
                    ${linkedStories.map(s => `
                        <div class="flex justify-between items-center bg-google-blue-light p-2 rounded border border-google-blue/30">
                            <span onclick="ui.openStoryModal('${s.id}')" class="text-sm cursor-pointer hover:underline">#${s.id} - ${escapeHtml(s.title)}</span>
                            <span class="text-xs bg-google-blue text-white px-2 py-0.5 rounded">${isBacklogStory(s) ? 'Backlog' : escapeHtml(s.state)}</span>
                        </div>
                    `).join('')}
                </div>
            `;
        } else {
            linkedStoriesHtml = `<div class="text-gray-400 text-sm italic">No stories linked to this project.</div>`;
        }

        const projectDueHtml = `
            <div class="flex items-center gap-2 mt-2 p-2 bg-gray-50 rounded-lg border border-gray-200">
                <span class="text-sm font-bold text-gray-600">📅 Due Date:</span>
                <input type="date" id="project-due-edit-${project.id}" value="${escapeHtml(project.dueDate || '')}" 
                       class="form-input form-input-sm flex-1">
                <button onclick="projectManager.updateProjectDueDate('${project.id}', document.getElementById('project-due-edit-${project.id}').value)" 
                        class="btn btn-primary text-sm">تحديث</button>
            </div>
        `;

        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const tasksHtmlWithEdit = (project.tasks || []).map(t => {
            const isDueTodayOrPast = t.dueDate ? new Date(t.dueDate) <= today : false;
            const dueClass = isDueTodayOrPast ? 'bg-google-red-light border-google-red/30 text-google-red' : '';
            return `
                <div class="bg-white border rounded p-3 shadow-sm ${dueClass}">
                    <div class="flex justify-between items-center flex-wrap gap-2">
                        <span class="font-medium text-slate-700">${escapeHtml(t.title)}</span>
                        <div class="flex items-center gap-2 flex-wrap">
                            <span class="text-xs font-bold px-2 py-0.5 rounded ${t.status === 'done' ? 'bg-google-green-light text-google-green' : t.status === 'active' ? 'bg-google-blue-light text-google-blue' : 'bg-gray-200 text-gray-600'}">${escapeHtml(t.status)}</span>
                            <div class="flex items-center gap-1">
                                <input type="date" id="task-due-${t.id}" value="${escapeHtml(t.dueDate || '')}" class="form-input form-input-sm w-28">
                                <button onclick="projectManager.updateTaskDueDate('${project.id}','${t.id}', document.getElementById('task-due-${t.id}').value)" 
                                        class="text-[10px] bg-purple-500 text-white px-2 py-0.5 rounded">تحديث</button>
                            </div>
                            <button onclick="projectManager.updateTaskStatus('${project.id}','${t.id}','todo')" class="text-[10px] bg-gray-100 hover:bg-gray-200 px-1.5 py-0.5 rounded">To Do</button>
                            <button onclick="projectManager.updateTaskStatus('${project.id}','${t.id}','active')" class="text-[10px] bg-google-blue-light hover:bg-google-blue/20 px-1.5 py-0.5 rounded">Active</button>
                            <button onclick="projectManager.updateTaskStatus('${project.id}','${t.id}','done')" class="text-[10px] bg-google-green-light hover:bg-google-green/20 px-1.5 py-0.5 rounded">Done</button>
                            <button onclick="projectManager.deleteTask('${project.id}','${t.id}')" class="text-google-red hover:text-red-700 text-sm font-bold">×</button>
                        </div>
                    </div>
                    ${isDueTodayOrPast ? `<div class="text-xs text-google-red font-bold mt-1">⚠️ مستحق اليوم أو مضى عليه</div>` : ''}
                    <div class="text-xs text-gray-400">Due: ${escapeHtml(t.dueDate || 'غير محدد')}</div>
                    <div class="mt-2 space-y-1">
                        ${(t.comments || []).map((c, idx) => `
                            <div class="flex justify-between items-start bg-gray-50 p-1.5 rounded border border-gray-100">
                                <span class="text-sm">${escapeHtml(c.text)}</span>
                                <div class="flex items-center gap-2">
                                    <span class="text-[9px] text-gray-400">${escapeHtml(c.timestamp)}</span>
                                    <button onclick="projectManager.deleteTaskComment('${project.id}','${t.id}',${idx})" class="text-google-red hover:text-red-600 text-xs">✕</button>
                                </div>
                            </div>
                        `).join('')}
                        <div class="flex gap-1 mt-1">
                            <input type="text" id="comment-input-${t.id}" placeholder="Add comment..." class="form-input form-input-sm flex-1">
                            <button onclick="projectManager.addTaskComment('${project.id}','${t.id}', document.getElementById('comment-input-${t.id}').value); document.getElementById('comment-input-${t.id}').value='';" class="bg-purple-600 text-white px-2 py-1 rounded text-xs">Add</button>
                        </div>
                    </div>
                </div>
            `;
        }).join('');

        let controlsHtml = '';
        if (project.status === 'active') {
            controlsHtml = `
                <div class="flex gap-3 mt-4">
                    <button onclick="projectManager.holdProject('${project.id}')" class="btn btn-warning">⏸ Hold</button>
                    <button onclick="projectManager.closeProject('${project.id}')" class="btn btn-danger">🔒 Close</button>
                </div>
            `;
        } else if (project.status === 'hold') {
            controlsHtml = `
                <div class="flex gap-3 mt-4">
                    <button onclick="projectManager.closeProject('${project.id}')" class="btn btn-danger">🔒 Close</button>
                    <span class="text-sm text-amber-700 bg-google-yellow-light p-2 rounded">⏸ On Hold until ${escapeHtml(project.holdEndDate)}</span>
                </div>
            `;
        } else {
            controlsHtml = `<div class="mt-4 text-sm text-gray-500 bg-gray-100 p-2 rounded">This project is closed since ${escapeHtml(project.closeDate)}</div>`;
        }

        body.innerHTML = `
            <div class="space-y-4">
                <div class="grid grid-cols-2 gap-2 text-sm bg-slate-50 p-4 rounded-xl">
                    <div><span class="font-bold">Team:</span> ${escapeHtml(project.team)}</div>
                    <div><span class="font-bold">Status:</span> ${escapeHtml(project.status)}</div>
                    ${project.status === 'hold' ? `<div><span class="font-bold">Hold Reason:</span> ${escapeHtml(project.holdReason)}</div>` : ''}
                    ${project.status === 'closed' ? `<div><span class="font-bold">Closed:</span> ${escapeHtml(project.closeDate)}</div>` : ''}
                </div>
                ${projectDueHtml}
                ${controlsHtml}
                <div class="border-t pt-4">${linkedStoriesHtml}</div>
                <div class="border-t pt-4">
                    <h4 class="font-bold text-purple-700 text-sm border-b pb-1">📋 Project Tasks</h4>
                    <div class="space-y-2 mt-2">${tasksHtmlWithEdit || '<div class="text-gray-400 text-sm italic">No tasks added yet.</div>'}</div>
                    <div class="mt-3 flex gap-2">
                        <input type="text" id="new-task-title-${project.id}" placeholder="Task title..." class="form-input flex-1">
                        <input type="date" id="new-task-due-${project.id}" class="form-input">
                        <button onclick="projectManager.addTask('${project.id}', document.getElementById('new-task-title-${project.id}').value, document.getElementById('new-task-due-${project.id}').value); document.getElementById('new-task-title-${project.id}').value=''; document.getElementById('new-task-due-${project.id}').value='';" class="btn btn-primary">Add Task</button>
                    </div>
                </div>
            </div>
        `;
        modal.classList.remove('hidden');
        document.body.style.overflow = 'hidden';
    },
    renderProjectDetailsModal: function(projectId) {
        this.openProjectDetails(projectId);
    }
};

// =================================================================
// SETTINGS, TAG MANAGER, COMMENT MANAGER, AZURE DEVOPS
// =================================================================
const settings = {
    addUser() {
        const username = document.getElementById('new-user-name').value;
        const password = document.getElementById('new-user-pass').value;
        const role = document.getElementById('new-user-role').value;
        if (!username || !password) return alert("Please fill all fields");
        if (db.users.some(u => u.username === username)) return alert("User already exists");
        db.users.push({ username, password, role });
        dataProcessor.saveToGitHub().then(() => { ui.showToast("User added successfully", "success"); ui.renderSettings(); });
    },
    removeUser(index) {
        if (db.users[index].username === currentUser.username) return alert("Cannot delete yourself!");
        db.users.splice(index, 1);
        dataProcessor.saveToGitHub();
        ui.renderSettings();
    },
    addVacation() {
        const name = document.getElementById('staff-select').value;
        const date = document.getElementById('vacation-date').value;
        if (!date) return;
        db.vacations.push({ name, date });
        dataProcessor.saveToGitHub();
        ui.renderSettings();
    },
    removeVacation(i) {
        db.vacations.splice(i, 1);
        dataProcessor.saveToGitHub();
        ui.renderSettings();
    },
    addHoliday() {
        const date = document.getElementById('holiday-date').value;
        if (!date) return;
        db.holidays.push(date);
        dataProcessor.saveToGitHub();
        ui.renderSettings();
    }
};

const tagManager = {
    addTag() {
        const input = document.getElementById('new-tag-input');
        const tagName = input.value.trim();
        if (!tagName || db.customTags.includes(tagName)) return;
        db.customTags.push(tagName);
        input.value = '';
        dataProcessor.saveToGitHub();
        this.renderTagsSettings();
        ui.renderAll();
    },
    removeTag(tagName) {
        db.customTags = db.customTags.filter(t => t !== tagName);
        db.currentStories.forEach(s => { if (s.customTag === tagName) delete s.customTag; });
        dataProcessor.saveToGitHub();
        this.renderTagsSettings();
        ui.renderAll();
    },
    assignTagToStory(storyId, tagName) {
        const story = db.currentStories.find(s => s.ID == storyId);
        if (story) { story.customTag = tagName; dataProcessor.saveToGitHub(); }
    },
    renderTagsSettings() {
        const container = document.getElementById('tags-list');
        if (!container) return;
        container.innerHTML = db.customTags.map(tag => `
            <span class="bg-purple-100 text-purple-800 px-3 py-1 rounded-full text-sm font-medium flex items-center gap-2">${escapeHtml(tag)}<button onclick="tagManager.removeTag('${encodeURIComponent(tag)}')" class="text-google-red hover:text-red-700 font-bold">×</button></span>
        `).join('');
    },
    toggleTagInStory(storyId, tagName) {
        tagName = decodeURIComponent(tagName);
        let story = db.currentStories.find(s => (s.id || s.ID) == storyId);
        if (!story) story = db.backlogStories.find(s => (s.id || s.ID) == storyId);
        if (story) {
            if (!story.customTags) story.customTags = [];
            const index = story.customTags.indexOf(tagName);
            if (index > -1) story.customTags.splice(index, 1);
            else story.customTags.push(tagName);
            dataProcessor.saveToGitHub();
            ui.renderKanban();
        } else {
            console.error("Story not found in database for ID:", storyId);
        }
    }
};

const commentManager = {
    updateComment(storyId, text) {
        if (!db.standupCommentsStore) db.standupCommentsStore = {};
        if (!db.standupCommentsStore[storyId]) db.standupCommentsStore[storyId] = [];
        db.standupCommentsStore[storyId].push({
            text: text,
            date: new Date().toLocaleString('en-GB'),
            timestamp: Date.now()
        });
        dataProcessor.saveToGitHub();
        ui.renderActiveCards();
    }
};

const azureDevOps = {
    async sync() {
        const pat = sessionStorage.getItem('az_pat');
        if (!pat) {
            ui.showToast("Azure PAT مفقود. الرجاء تسجيل الدخول مجدداً.", "error");
            return;
        }
        const syncBtn = document.querySelector("button[onclick='azureDevOps.sync()']");
        const originalText = syncBtn.innerHTML;
        syncBtn.innerHTML = "⏳ جاري المزامنة...";
        syncBtn.disabled = true;
        ui.showLoader();
        try {
            const authHeader = 'Basic ' + btoa(':' + pat);
            const mainQueryUrl = `https://dev.azure.com/${AZURE_CONFIG.ORG}/${AZURE_CONFIG.PROJECT}/_apis/wit/wiql/${AZURE_CONFIG.QUERY_ID}?api-version=6.0`;
            const mainRes = await fetch(mainQueryUrl, { headers: { 'Authorization': authHeader } });
            const mainData = await mainRes.json();
            const mainRelations = mainData.workItemRelations || [];
            const mainIds = [...new Set(mainRelations.map(r => r.target ? r.target.id : null).filter(id => id))];
            let backlogIds = [];
            if (AZURE_CONFIG.BACKLOG_QUERY_ID) {
                const backlogQueryUrl = `https://dev.azure.com/${AZURE_CONFIG.ORG}/${AZURE_CONFIG.PROJECT}/_apis/wit/wiql/${AZURE_CONFIG.BACKLOG_QUERY_ID}?api-version=6.0`;
                const backlogRes = await fetch(backlogQueryUrl, { headers: { 'Authorization': authHeader } });
                const backlogData = await backlogRes.json();
                if (backlogData.workItemRelations && backlogData.workItemRelations.length > 0) {
                    backlogIds = backlogData.workItemRelations.map(r => r.target ? r.target.id : null).filter(id => id);
                } else if (backlogData.workItems && backlogData.workItems.length > 0) {
                    backlogIds = backlogData.workItems.map(wi => wi.id).filter(id => id);
                }
                console.log(`✅ Backlog IDs extracted: ${backlogIds.length}`);
            }
            const allIds = [...new Set([...mainIds, ...backlogIds])];
            if (allIds.length === 0) throw new Error("No items found in the specified queries.");
            const chunkSize = 200;
            let allDetails = [];
            for (let i = 0; i < allIds.length; i += chunkSize) {
                const chunk = allIds.slice(i, i + chunkSize);
                const batchUrl = `https://dev.azure.com/${AZURE_CONFIG.ORG}/_apis/wit/workitemsbatch?api-version=6.0`;
                const batchRes = await fetch(batchUrl, {
                    method: 'POST',
                    headers: { 'Authorization': authHeader, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ ids: chunk, fields: this.getRequiredFields() })
                });
                const batchData = await batchRes.json();
                allDetails = allDetails.concat(batchData.value);
            }
            const detailsMap = new Map(allDetails.map(d => [d.id, d.fields]));
            const mainRows = this.buildRowsFromRelations(mainRelations, detailsMap);
            await dataProcessor.processRows(mainRows);
            const backlogDetails = allDetails.filter(d => backlogIds.includes(d.id));
            const backlogRows = this.buildBacklogRows(backlogDetails);
            await dataProcessor.processBacklogRows(backlogRows);
            ui.showToast("✅ تمت المزامنة بنجاح مع Azure!", "success");
        } catch (error) {
            console.error("Azure Sync Error:", error);
            ui.showToast("❌ فشل الاتصال بـ Azure: " + error.message, "error");
        } finally {
            ui.hideLoader();
            syncBtn.innerHTML = originalText;
            syncBtn.disabled = false;
        }
    },
    buildRowsFromRelations(relations, detailsMap) {
        const rows = [];
        relations.forEach(rel => {
            if (!rel.target) return;
            const fields = detailsMap.get(rel.target.id);
            if (!fields) return;
            rows.push({
                'ID': rel.target.id,
                'Work Item Type': fields["System.WorkItemType"],
                'Title': fields["System.Title"],
                'Assigned To': fields["System.AssignedTo"]?.displayName || "Unassigned",
                'Activity': fields["Microsoft.VSTS.Common.Activity"] || "",
                'Original Estimation': fields["NT.OriginalEstimation"] || 0,
                'TimeSheet_DevActualTime': fields["Custom.TimeSheet_DevActualTime"] || 0,
                'TimeSheet_TestingActualTime': fields["Custom.TimeSheet_TestingActualTime"] || 0,
                'Activated Date': fields["Microsoft.VSTS.Common.ActivatedDate"],
                'Business Area': fields["MyCompany.MyProcess.BusinessArea"],
                'Iteration Path': fields["System.IterationPath"],
                'CustomResolvedDate': fields["Custom.CustomResolvedDate"],
                'Tested Date': fields["MyCompany.MyProcess.TestedDate"],
                'Assigned To Tester': fields["MyCompany.MyProcess.Tester"]?.displayName || "Unassigned",
                'Resolved Date': fields["Microsoft.VSTS.Common.ResolvedDate"],
                'State': fields["System.State"],
                'Release Expected Date': fields["MyCompany.MyProcess.Release"],
                'Business Priority': fields["MyCompany.MyProcess.BusinessPriority"],
                'Tags': fields["System.Tags"],
                'Changed Date': fields["System.ChangedDate"],
                'Branch': fields["NT.Branch"],
                'Customer': fields["Nt.Customer"]
            });
        });
        return rows;
    },
    getRequiredFields() {
        return [
            "System.Id", "System.WorkItemType", "System.Title", "System.AssignedTo",
            "Microsoft.VSTS.Common.Activity", "NT.OriginalEstimation",
            "Custom.TimeSheet_DevActualTime", "Custom.TimeSheet_TestingActualTime",
            "Microsoft.VSTS.Common.ActivatedDate", "MyCompany.MyProcess.BusinessArea",
            "System.IterationPath", "Custom.CustomResolvedDate", "MyCompany.MyProcess.TestedDate",
            "MyCompany.MyProcess.Tester", "Microsoft.VSTS.Common.ResolvedDate",
            "System.State", "MyCompany.MyProcess.Release", "MyCompany.MyProcess.BusinessPriority",
            "System.Tags", "System.ChangedDate", "NT.Branch", "Nt.Customer"
        ];
    },
    buildBacklogRows(details) {
        const rows = [];
        details.forEach(d => {
            const fields = d.fields || {};
            const state = fields["System.State"] || "";
            if (!["New", "Approved"].includes(state)) return;
            let area = fields["MyCompany.MyProcess.BusinessArea"] || "";
            if (area && area.trim().toLowerCase() === "integration") area = "LDM Integration";
            if (!area || area.trim() === "") {
                const path = fields["System.IterationPath"] || "";
                area = path.includes('\\') ? path.split('\\')[0] : path;
            }
            rows.push({
                'ID': d.id,
                'Work Item Type': fields["System.WorkItemType"] || "User Story",
                'Title': fields["System.Title"] || "Untitled",
                'Assigned To': fields["System.AssignedTo"]?.displayName || "Unassigned",
                'Business Area': area,
                'State': state,
                'Business Priority': fields["MyCompany.MyProcess.BusinessPriority"] || 999,
                'Release Expected Date': fields["MyCompany.MyProcess.Release"] ? new Date(fields["MyCompany.MyProcess.Release"]) : null,
                'Tags': fields["System.Tags"] || "",
                'Iteration Path': fields["System.IterationPath"] || "",
                'Changed Date': fields["System.ChangedDate"] ? new Date(fields["System.ChangedDate"]) : null
            });
        });
        return rows;
    },
    saveSettings() {
        const settings = {
            org: document.getElementById('az-org').value,
            project: document.getElementById('az-project').value,
            queryId: document.getElementById('az-query-id').value,
            backlogQueryId: document.getElementById('az-backlog-query-id').value
        };
        localStorage.setItem('az_settings', JSON.stringify(settings));
        ui.showToast("تم حفظ إعدادات Azure بنجاح", "success");
    }
};

function executeWithSave(action, successMsg = 'تم الحفظ بنجاح', errorMsg = 'فشل الحفظ', callback = null) {
    ui.showLoader();
    Promise.resolve(action())
        .then(() => dataProcessor.saveToGitHub())
        .then(() => {
            ui.showToast(successMsg, 'success');
            if (callback) callback();
            else ui.renderAll();
        })
        .catch(err => {
            console.error(err);
            ui.showToast(`${errorMsg}: ${err.message}`, 'error');
        })
        .finally(() => ui.hideLoader());
}

window.onload = () => {
    if (!db.areaComments) db.areaComments = [];
    if (!db.projects) db.projects = [];
    if (!db.archivedProjects) db.archivedProjects = [];
    if (!db.standupCommentsStore) db.standupCommentsStore = {};
    const saved = localStorage.getItem('saved_creds');
    if (saved) {
        const creds = JSON.parse(saved);
        document.getElementById('username').value = creds.u;
        document.getElementById('password').value = creds.p;
        document.getElementById('gh-token').value = creds.t;
        document.getElementById('az-pat').value = creds.azPat;
        auth.handleLogin();
    }
};
