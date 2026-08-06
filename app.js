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
    BACKLOG_MONTHS: 2 // عدد الأشهر للـ Roadmap
};

let db = {
    users: [],
    vacations: [], 
    holidays: [],  
    deliveryLogs: [],
    currentStories: [],
    customTags: [],
    backlogStories: [] // NEW: for backlog stories from second query
};

let currentData = []; 
let currentUser = null;

// Helper to check if a story is from backlog
function isBacklogStory(story) {
    return story && story.isBacklog === true;
}

const archiver = {
    async runArchive() {
        const TenDaysAgo = Date.now() - (31 * 24 * 60 * 60 * 1000);
        
        const logsToArchive = db.deliveryLogs.filter(log => log.timestamp < TenDaysAgo);
        const logsToKeep = db.deliveryLogs.filter(log => log.timestamp >= TenDaysAgo);

        if (logsToArchive.length === 0) return;

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

/**
 * Authentication & GitHub Sync
 */
const auth = {
    async handleLogin() {
        const u = document.getElementById('username').value;
        const p = document.getElementById('password').value;
        const t = document.getElementById('gh-token').value;
        const azPat = document.getElementById('az-pat').value;
        const rem = document.getElementById('remember-me').checked;

        if(!u || !p || !t || !azPat) return alert("برجاء ملء جميع البيانات بما في ذلك Azure PAT");
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
                    sessionStorage.setItem('gh_token', t);
                    sessionStorage.setItem('az_pat', azPat);
                    if(rem) localStorage.setItem('saved_creds', JSON.stringify({u, p, t, azPat}));
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

/**
 * Data Processing Engine - with concurrency fix
 */
const dataProcessor = {
    _savePromise: null,   // lock to prevent concurrent saves

    async saveToGitHub() {
        if (this._savePromise) {
            return this._savePromise;
        }
        this._savePromise = this._saveToGitHubInternal()
            .finally(() => { this._savePromise = null; });
        return this._savePromise;
    },

    async _saveToGitHubInternal() {
        const token = sessionStorage.getItem('gh_token');
        if (!token) throw new Error('GitHub token missing');

        // 1. Fetch latest SHA
        const timestamp = Date.now();
        const metaRes = await fetch(`https://api.github.com/repos/${CONFIG.REPO_NAME}/contents/${CONFIG.FILE_PATH}?t=${timestamp}`, {
            headers: { 'Authorization': `token ${token}` }
        });
        if (!metaRes.ok) {
            throw new Error(`Failed to get metadata: ${metaRes.status}`);
        }
        const metaData = await metaRes.json();
        const latestSha = metaData.sha;

        // 2. Prepare data
        const dataToSave = { ...db };
        delete dataToSave.sha;
        const jsonString = JSON.stringify(dataToSave, null, 2);
        const content = btoa(unescape(encodeURIComponent(jsonString)));

        // 3. Save
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
                // Retry once with fresh SHA
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
                
                const metaRes = await fetch(`https://api.github.com/repos/${CONFIG.REPO_NAME}/contents/${CONFIG.FILE_PATH}`, {
                    headers: { 'Authorization': `token ${token}` }
                });
                const metaData = await metaRes.json();
                db.sha = metaData.sha; 
                
                if (db.currentStories && db.currentStories.length > 0) {
                    db.currentStories.forEach(s => {
                        if (s.expectedRelease) s.expectedRelease = new Date(s.expectedRelease);
                        if (s.changedDate) s.changedDate = new Date(s.changedDate);
                    });
                    this.calculateTimelines(db.currentStories);
                }
                ui.renderAll();
            } else {
                console.log("File not found, creating new DB...");
                this.saveToGitHub();
            }
        } catch (e) { 
            console.error("Sync Error:", e);
            alert("خطأ في المزامنة مع GitHub: " + e.message); 
        }
    },    

    handleCSV(event) {
        const file = event.target.files[0];
        Papa.parse(file, {
            header: true,
            skipEmptyLines: true,
            complete: (results) => {
                this.processRows(results.data);
            }
        });
    },

    processRows(rows) {
        const newStories = [];
        let currentStory = null;

        rows.forEach(row => {
            const itemType = row['Work Item Type'];
            if (itemType === 'User Story' || itemType === 'CR' || itemType === 'Support Log') {
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
                    standupComments: [],
                    iterationPath: row['Iteration Path'] || "",
                    devActualTime: parseFloat(row['TimeSheet_DevActualTime']) || 0,
                    testActualTime: parseFloat(row['TimeSheet_TestingActualTime']) || 0,
                    isBacklog: false
                };

                const existingStory = db.currentStories.find(s => s.id == currentStory.id);
                if (existingStory) {
                    if (existingStory.customTags) {
                        currentStory.customTags = existingStory.customTags;
                    }
                    if (existingStory.standupComments) {
                        currentStory.standupComments = existingStory.standupComments;
                    }
                }

                newStories.push(currentStory);
            } 
            else if (row['Work Item Type'] === 'Task' && currentStory) {
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
        this.saveToGitHub().then(() => alert("تم تحديث البيانات بنجاح"));
    },

    // NEW: Process backlog rows from second query
    processBacklogRows(rows) {
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
                standupComments: [],
                iterationPath: row['Iteration Path'] || "",
                devActualTime: 0,
                testActualTime: 0,
                isBacklog: true // MARK as backlog
            };
        }).filter(s => s !== null);

        db.backlogStories = backlogStories;
        this.saveToGitHub().then(() => {
            console.log(`Saved ${backlogStories.length} backlog stories`);
            ui.renderAll();
        }).catch(err => {
            console.error('Failed to save backlog:', err);
            alert('فشل حفظ الباك لوج: ' + err.message);
        });
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
                        
                        if (bugFinish > finalDeliveryDate) {
                            finalDeliveryDate = bugFinish;
                        }

                        if (bugFinish > staffAvailability[story.assignedTo]) {
                            staffAvailability[story.assignedTo] = new Date(bugFinish);
                        }
                    }
                });
            }
            story.calc.finalEnd = finalDeliveryDate;
        });

        currentData = stories;
        ui.renderAll();
    }
};

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
            if (!this.isWorkDay(current, personName)) {
                count++;
            }
            current.setDate(current.getDate() + 1);
        }
        return count;
    },
    
    countVacationDays(startDate, endDate, person) {
        if (!(startDate instanceof Date) || !(endDate instanceof Date) || isNaN(startDate) || isNaN(endDate)) return 0;
        
        let count = 0;
        let current = new Date(startDate);
        
        while (current <= endDate) {
            if (!this.isWorkDay(current, person)) {
                count++;
            }
            current.setDate(current.getDate() + 1);
        }
        return count;
    },

    addWorkingHours(startDate, hours, person) {
        let result = new Date(startDate);
        let remainingHours = hours;

        while(!this.isWorkDay(result, person)) {
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

/**
 * UI Rendering
 */
const ui = {
    switchTab(tabId) {
        document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
        document.getElementById(`tab-${tabId}`).classList.add('active');
        this.renderAll();
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
        if (activeTab) {
            if (activeTab.id === 'tab-daily-activity') {
                this.renderDailyActivity();
            } else if (activeTab.id === 'tab-inactive-stories') {
                this.renderInactiveStories();
            } else if (activeTab.id === 'tab-kanban') { 
                this.renderKanban();
            } else if (activeTab.id === 'tab-auditor') {
                this.renderAuditorChecklist();
            }
        }
    },
    
    renderDashboard() {
        const container = document.getElementById('dashboard-container');
        if (!container) return;

        // --- Staff Stats ---
        const activeDevsSet = new Set();
        const activeTestersSet = new Set();
        const activeStories = currentData.filter(s => s.state !== 'Tested' && s.state !== 'Closed' && !isBacklogStory(s));
        
        activeStories.forEach(s => {
            if (s.assignedTo && s.assignedTo !== "Unassigned") activeDevsSet.add(s.assignedTo);
            if (s.tester && s.tester !== "Unassigned") activeTestersSet.add(s.tester);
        });

        const freeDevs = this.getFreeStaff('dev');
        const freeTesters = this.getFreeStaff('tester');

        const staffStatsHtml = `
            <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                <div onclick="ui.showStaffDetails('dev', 'active')" 
                     class="bg-gradient-to-br from-blue-500 to-blue-700 p-4 rounded-2xl shadow-lg text-white cursor-pointer hover:scale-105 transition-transform">
                    <div class="text-[10px] opacity-80 font-bold uppercase tracking-wider">Active Developers</div>
                    <div class="text-4xl font-black mt-1">${activeDevsSet.size}</div>
                    <div class="text-[10px] mt-2 bg-white/20 inline-block px-2 py-0.5 rounded">Click for details</div>
                </div>
                <div onclick="ui.showStaffDetails('tester', 'active')" 
                     class="bg-gradient-to-br from-emerald-500 to-emerald-700 p-4 rounded-2xl shadow-lg text-white cursor-pointer hover:scale-105 transition-transform">
                    <div class="text-[10px] opacity-80 font-bold uppercase tracking-wider">Active Testers</div>
                    <div class="text-4xl font-black mt-1">${activeTestersSet.size}</div>
                    <div class="text-[10px] mt-2 bg-white/20 inline-block px-2 py-0.5 rounded">Click for details</div>
                </div>
                <div onclick="ui.showStaffDetails('dev', 'free')" 
                     class="bg-gradient-to-br from-slate-500 to-slate-700 p-4 rounded-2xl shadow-lg text-white cursor-pointer hover:scale-105 transition-transform">
                    <div class="text-[10px] opacity-80 font-bold uppercase tracking-wider">Free Developers</div>
                    <div class="text-4xl font-black mt-1">${freeDevs.length}</div>
                    <div class="text-[10px] mt-2 bg-white/20 inline-block px-2 py-0.5 rounded">Click for details</div>
                </div>
                <div onclick="ui.showStaffDetails('tester', 'free')" 
                     class="bg-gradient-to-br from-purple-500 to-purple-700 p-4 rounded-2xl shadow-lg text-white cursor-pointer hover:scale-105 transition-transform">
                    <div class="text-[10px] opacity-80 font-bold uppercase tracking-wider">Free Testers</div>
                    <div class="text-4xl font-black mt-1">${freeTesters.length}</div>
                    <div class="text-[10px] mt-2 bg-white/20 inline-block px-2 py-0.5 rounded">Click for details</div>
                </div>
            </div>
        `;

        // --- Area State Map (exclude backlog) ---
        const areaStateMap = {};
        const allStates = new Set();
        const nonBacklogData = currentData.filter(s => !isBacklogStory(s));
        
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
            <div class="bg-white p-6 rounded-xl shadow-sm border">
                <h3 class="font-bold text-slate-700 mb-4 flex items-center gap-2">
                    📊 Business Area Stats (By State)
                </h3>
                <div class="overflow-x-auto">
                    <table class="w-full text-sm">
                        <thead>
                            <tr class="bg-gray-50 border-b">
                                <th class="text-left p-2 font-bold text-gray-600">Business Area</th>
                                ${sortedStates.map(state => `<th class="text-center p-2 font-bold text-gray-600">${state}</th>`).join('')}
                                <th class="text-center p-2 font-bold text-indigo-600">Total</th>
                            </tr>
                        </thead>
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

            areaStatsHtml += `
                <tr class="border-b hover:bg-gray-50">
                    <td class="p-2 font-medium text-slate-700">${area}</td>
                    ${rowCells}
                    <td class="text-center p-2 border-t font-bold text-indigo-600">${rowTotal}</td>
                </tr>
            `;
        });

        areaStatsHtml += `
                    <tr class="bg-gray-100 font-bold">
                        <td class="p-2 text-slate-800">Grand Total</td>
                        ${sortedStates.map(state => {
                            let total = 0;
                            Object.values(areaStateMap).forEach(areaData => { total += areaData[state] || 0; });
                            return `<td class="text-center p-2">${total}</td>`;
                        }).join('')}
                        <td class="text-center p-2 text-indigo-700">${grandTotal}</td>
                    </tr>
                </tbody>
            </table>
        </div>
        `;

        // --- Branch Stats (exclude backlog) ---
        const branchMap = {};
        const activeNonBacklog = nonBacklogData.filter(s => s.state !== 'Tested' && s.state !== 'Closed');
        activeNonBacklog.forEach(s => {
            const branch = s.branch || 'N/A';
            branchMap[branch] = (branchMap[branch] || 0) + 1;
        });
        const sortedBranches = Object.entries(branchMap).sort((a, b) => b[1] - a[1]);

        let branchStatsHtml = `
            <div class="bg-white p-6 rounded-xl shadow-sm border">
                <h3 class="font-bold text-slate-700 mb-4 flex items-center gap-2">
                    🌿 Active Stories by Branch
                </h3>
                <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        `;
        sortedBranches.forEach(([branch, count]) => {
            branchStatsHtml += `
                <div class="bg-indigo-50 p-3 rounded-lg border border-indigo-100 text-center cursor-pointer hover:bg-indigo-100 transition" onclick="ui.showBranchModal('${branch}')">
                    <div class="text-xs font-bold text-indigo-600 truncate" title="${branch}">${branch}</div>
                    <div class="text-2xl font-black text-indigo-800">${count}</div>
                </div>
            `;
        });
        branchStatsHtml += `
            </div>
            <div class="mt-2 text-xs text-gray-400">Total Active Stories: ${activeNonBacklog.length}</div>
        </div>
        `;

        // --- Customer Stats (exclude backlog) ---
        const customerMap = {};
        activeNonBacklog.forEach(s => {
            const customer = s.customer || 'General';
            customerMap[customer] = (customerMap[customer] || 0) + 1;
        });
        const sortedCustomers = Object.entries(customerMap).sort((a, b) => b[1] - a[1]);

        let customerStatsHtml = `
            <div class="bg-white p-6 rounded-xl shadow-sm border">
                <h3 class="font-bold text-slate-700 mb-4 flex items-center gap-2">
                    👥 Active Stories by Customer
                </h3>
                <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        `;
        sortedCustomers.forEach(([customer, count]) => {
            customerStatsHtml += `
                <div class="bg-emerald-50 p-3 rounded-lg border border-emerald-100 text-center cursor-pointer hover:bg-emerald-100 transition" onclick="ui.showCustomerModal('${customer}')">
                    <div class="text-xs font-bold text-emerald-600 truncate" title="${customer}">${customer}</div>
                    <div class="text-2xl font-black text-emerald-800">${count}</div>
                </div>
            `;
        });
        customerStatsHtml += `
            </div>
            <div class="mt-2 text-xs text-gray-400">Total Active Stories: ${activeNonBacklog.length}</div>
        </div>
        `;

        // --- Roadmap (including backlog stories) ---
        const allStoriesForRoadmap = [...currentData, ...db.backlogStories];
        const roadmapHtml = this.renderClientRoadmap(allStoriesForRoadmap);

        container.innerHTML = `
            ${staffStatsHtml}
            ${areaStatsHtml}
            <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
                ${branchStatsHtml}
                ${customerStatsHtml}
            </div>
            <div class="mt-6">
                ${roadmapHtml}
            </div>
        `;
    },

    // Modified to accept stories array and show 2 months
    renderClientRoadmap(stories = []) {
        const today = new Date();
        const twoMonthsLater = new Date();
        twoMonthsLater.setMonth(twoMonthsLater.getMonth() + CONFIG.BACKLOG_MONTHS);

        const upcomingDeliveries = stories.filter(s => {
            if (!s.expectedRelease || !(s.expectedRelease instanceof Date)) return false;
            const isNotDone = s.state !== 'Tested' && s.state !== 'Closed';
            const isWithinRange = s.expectedRelease >= today && s.expectedRelease <= twoMonthsLater;
            return isNotDone && isWithinRange;
        });

        upcomingDeliveries.sort((a, b) => a.expectedRelease - b.expectedRelease);

        let html = `
            <div class="bg-white p-6 rounded-xl shadow-sm border">
                <h3 class="font-bold text-indigo-700 mb-4 flex items-center gap-2">
                    🚀 Client Delivery Roadmap (Next ${CONFIG.BACKLOG_MONTHS} Months)
                    <span class="text-xs font-normal text-gray-400 ml-2">(${upcomingDeliveries.length} items)</span>
                </h3>
                <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4" id="roadmap-container">
        `;

        if (upcomingDeliveries.length === 0) {
            html += `<div class="col-span-full text-center py-8 text-gray-400">No client deliveries expected in the next ${CONFIG.BACKLOG_MONTHS} months.</div>`;
        } else {
            html += upcomingDeliveries.map(s => {
                const diffTime = Math.abs(s.expectedRelease - today);
                const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                
                let urgencyClass = "border-blue-200 bg-white";
                if (diffDays <= 7) urgencyClass = "border-amber-400 bg-amber-50";
                if (diffDays <= 3) urgencyClass = "border-red-400 bg-red-50";
                
                const isBacklog = isBacklogStory(s) ? '📋 ' : '';

                return `
                    <div class="p-4 rounded-xl border-2 ${urgencyClass} shadow-sm ${isBacklogStory(s) ? 'border-dashed' : ''}">
                        <div class="flex justify-between items-start mb-2">
                            <span class="text-[10px] font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded">In ${diffDays} Days</span>
                            <span class="text-[10px] text-gray-400">#${s.id}</span>
                        </div>
                        <div class="text-sm font-bold text-slate-800 truncate" title="${s.title}">${isBacklog}${s.title}</div>
                        <div class="text-[11px] text-gray-500 mt-1">Area: ${s.area}</div>
                        ${isBacklogStory(s) ? '<div class="text-[10px] text-purple-600 font-bold mt-1">📋 Backlog</div>' : ''}
                        <div class="mt-3 flex justify-between items-center">
                            <div class="text-[10px] font-bold uppercase text-gray-400">Release:</div>
                            <div class="text-xs font-bold text-slate-700">${s.expectedRelease.toLocaleDateString('en-GB')}</div>
                        </div>
                        <div class="mt-2 h-1 w-full bg-gray-100 rounded-full overflow-hidden">
                            <div class="h-full ${isBacklogStory(s) ? 'bg-purple-400' : 'bg-indigo-500'}" style="width: ${s.state === 'Resolved' ? '80%' : '40%'}"></div>
                        </div>
                    </div>
                `;
            }).join('');
        }

        html += `</div></div>`;
        return html;
    },

    getFreeStaff(role) {
        const allStaff = new Set();
        const nonBacklog = currentData.filter(s => !isBacklogStory(s));
        
        nonBacklog.forEach(s => {
            if (role === 'dev' && s.assignedTo && s.assignedTo !== "Unassigned") {
                allStaff.add(s.assignedTo);
            } else if (role === 'tester' && s.tester && s.tester !== "Unassigned") {
                allStaff.add(s.tester);
            }
        });

        const busyStaff = new Set();

        nonBacklog.forEach(s => {
            const activeTasks = (s.tasks || []).filter(t => 
                t['State'] !== 'To Be Reviewed' && t['State'] !== 'Closed' &&
                parseFloat(t['Original Estimation'] || 0) > 0
            );
            activeTasks.forEach(t => {
                if (role === 'dev' && ["Development", "DB Modification"].includes(t['Activity'])) {
                    if (s.assignedTo && s.assignedTo !== "Unassigned") busyStaff.add(s.assignedTo);
                } else if (role === 'tester' && t['Activity'] === 'Testing') {
                    if (s.tester && s.tester !== "Unassigned") busyStaff.add(s.tester);
                }
            });
        });

        nonBacklog.forEach(s => {
            if (s.type === 'Support Log' && s.state !== 'Tested' && s.state !== 'Closed') {
                if (role === 'dev' && s.assignedTo && s.assignedTo !== "Unassigned") {
                    busyStaff.add(s.assignedTo);
                }
                if (role === 'tester' && s.tester && s.tester !== "Unassigned") {
                    busyStaff.add(s.tester);
                }
            }
        });

        nonBacklog.forEach(s => {
            if (s.bugs && s.bugs.length > 0) {
                s.bugs.forEach(bug => {
                    if (['New', 'Active'].includes(bug['State'])) {
                        const worker = bug['Assigned To'];
                        if (worker && worker !== "Unassigned") {
                            busyStaff.add(worker);
                        }
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
            const nonBacklog = currentData.filter(s => !isBacklogStory(s));
            list.forEach(name => {
                if (showStoryCount) {
                    let count = 0;
                    if (title.includes('Developers')) {
                        count = nonBacklog.filter(s => s.assignedTo === name && s.state !== 'Tested' && s.state !== 'Closed').length;
                    } else if (title.includes('Testers')) {
                        count = nonBacklog.filter(s => s.tester === name && s.state !== 'Tested' && s.state !== 'Closed').length;
                    }
                    html += `
                        <div class="flex justify-between items-center bg-slate-50 p-3 rounded-xl border border-slate-100">
                            <span class="font-bold text-slate-700">${name}</span>
                            <span class="bg-indigo-100 text-indigo-700 px-3 py-1 rounded-full text-xs font-bold">${count} Stories</span>
                        </div>
                    `;
                } else {
                    html += `
                        <div class="flex justify-between items-center bg-slate-50 p-3 rounded-xl border border-slate-100">
                            <span class="font-bold text-slate-700">${name}</span>
                            <span class="bg-emerald-100 text-emerald-700 px-3 py-1 rounded-full text-xs font-bold">Free</span>
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
        const nonBacklog = currentData.filter(s => !isBacklogStory(s));
        if (type === 'active') {
            const set = new Set();
            const activeStories = nonBacklog.filter(s => s.state !== 'Tested' && s.state !== 'Closed');
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
        
        // Exclude backlog stories from active cards
        const nonBacklog = currentData.filter(s => !isBacklogStory(s));
        
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
            container.innerHTML = `<div class="col-span-full text-center py-20 text-gray-400">
                ${searchTerm ? 'لا توجد نتائج تطابق بحثك.' : 'No active stories found.'}
            </div>`;
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
                        <span class="w-2 h-6 bg-indigo-600 rounded-full"></span>
                        ${area} 
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
                            if (dateEngine.isWorkDay(current, s.assignedTo)) {
                                activeDaysCount++;
                            }
                            current.setDate(current.getDate() + 1);
                        }
                    }

                    let activeDaysColor = "bg-emerald-500";
                    if (activeDaysCount >= 7 && activeDaysCount <= 12) {
                        activeDaysColor = "bg-amber-500";
                    } else if (activeDaysCount > 12) {
                        activeDaysColor = "bg-rose-600 shadow-rose-200 animate-pulse";
                    }

                    const devVacDaysNow = devActivatedDates.length > 0 
                        ? dateEngine.countVacationDaysUntilNow(devActivatedDates[0], s.assignedTo) 
                        : 0;

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
                    
                    const testVacDaysNow = (execTask && execTask['Activated Date']) 
                        ? dateEngine.countVacationDaysUntilNow(execTask['Activated Date'], s.tester) 
                        : 0;

                    if (execTask && execTask['Activated Date']) {
                        testStartDisplay = new Date(execTask['Activated Date']).toLocaleDateString('en-GB');
                    }

                    const isDevLate = s.calc.devEnd instanceof Date && now > s.calc.devEnd && (s.state !== 'Resolved' && s.state !== 'Tested' && s.state !== 'Closed');
                    const devLightColor = (s.state === 'Resolved' || s.state === 'Tested' || s.state === 'Closed') ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]' : (isDevLate ? 'bg-red-500 animate-pulse shadow-[0_0_8px_rgba(239,68,68,0.6)]' : 'bg-gray-300');

                    const isTestLate = s.calc.testEnd instanceof Date && now > s.calc.testEnd && (s.state !== 'Tested' && s.state !== 'Closed');
                    const testLightColor = (s.state === 'Tested' || s.state === 'Closed') ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]' : (isTestLate ? 'bg-red-500 animate-pulse shadow-[0_0_8px_rgba(239,68,68,0.6)]' : 'bg-gray-300');

                    const nonTestTasks = s.tasks.filter(t => t['Activity'] !== 'Testing' && t['Activity'] !== 'Preparation');
                    const totalDevTasks = nonTestTasks.length;
                    const completedDevTasks = nonTestTasks.filter(t => ['Closed', 'To Be Reviewed', 'Resolved'].includes(t['State'])).length;
                    const devProgressPercent = totalDevTasks > 0 ? Math.round((completedDevTasks / totalDevTasks) * 100) : 0;

                    const totalBugs = s.bugs ? s.bugs.length : 0;
                    const completedBugs = s.bugs ? s.bugs.filter(b => ['Closed', 'Resolved'].includes(b['State'])).length : 0;
                    const totalBugEffort = s.bugs ? s.bugs.reduce((acc, b) => acc + parseFloat(b['Original Estimation'] || 0), 0) : 0;
                    const completedBugEffort = s.bugs ? s.bugs.filter(b => ['Closed', 'Resolved'].includes(b['State']))
                                                                  .reduce((acc, b) => acc + parseFloat(b['Original Estimation'] || 0), 0) : 0;
                    const remainingBugEffort = Math.max(0, totalBugEffort - completedBugEffort);
                    const bugProgressPercent = totalBugEffort > 0 ? Math.round((completedBugEffort / totalBugEffort) * 100) : 0;

                    const testCases = s.testCases || [];
                    const totalTC = testCases.length;
                    const completedTC = testCases.filter(tc => ['Pass', 'Fail', 'Not Applicable'].includes(tc.state)).length;
                    const progressPercent = totalTC > 0 ? Math.round((completedTC / totalTC) * 100) : 0;

                    let statusColor = isLate ? "bg-red-100 text-red-700" : (hasError ? "bg-amber-100 text-amber-700" : "bg-blue-100 text-blue-700");
                    const statusText = isLate ? `Overdue ⚠️ (${s.state})` : s.state;

                    const customTagsList = db.customTags || [];
                    const storyTags = s.customTags || [];
                    const comments = s.standupComments || [];

                    return `
                    <div class="relative bg-white rounded-2xl shadow-sm border border-gray-100 hover:shadow-md hover:border-indigo-200 transition-all overflow-visible flex flex-col mb-4">
                         
                        ${activeDaysCount > 0 ? `
                        <div class="absolute top-0 right-0 mt-8 mr-4 flex flex-col items-center justify-center ${activeDaysColor} text-white w-14 h-14 rounded-xl shadow-lg transform rotate-3 z-10 transition-colors duration-500">
                            <span class="text-xl font-black leading-none">${activeDaysCount}</span>
                            <span class="text-[8px] uppercase font-bold">Days</span>
                        </div>
                        ` : ''}

                        <div class="p-5 flex-1">
                            <div class="flex justify-between items-start mb-4">
                                <div class="flex gap-2">
                                    <span class="px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider ${statusColor}">${statusText}</span>
                                    <span class="px-2 py-0.5 rounded bg-gray-100 text-[10px] font-bold text-gray-600">P${s.priority || 999}</span>
                                </div>
                                <span onclick="ui.openStoryModal('${s.id}')" class="text-xs font-mono text-gray-400 cursor-pointer hover:text-indigo-600">#${s.id} 🔍</span>
                            </div>

                            <div class="flex flex-wrap gap-1 mt-2 mb-3">
                                ${s.tags.map(t => `<span class="px-2 py-0.5 bg-red-50 text-red-700 border border-red-200 rounded text-[10px] font-semibold">${t}</span>`).join('')}
                            </div>

                            <div class="flex flex-wrap items-center gap-1.5 mb-4 border-b border-dashed border-gray-100 pb-3 overflow-visible">
                                ${storyTags.map(tag => `
                                    <span class="inline-flex items-center gap-1 px-2 py-1 bg-purple-100 text-purple-700 border border-purple-200 rounded-md text-[10px] font-bold">
                                        ${tag}
                                        <button onclick="tagManager.toggleTagInStory('${s.id}', '${tag}')" class="hover:text-purple-900 font-black ml-1">×</button>
                                    </span>
                                `).join('')}
                                
                                <div class="relative inline-block group">
                                    <button class="w-6 h-6 flex items-center justify-center rounded-full bg-gray-50 border border-gray-200 text-gray-400 hover:bg-indigo-50 hover:text-indigo-600 transition-all pb-0.5">
                                        <span class="text-sm font-bold">+</span>
                                    </button>
                                    
                                    <div class="hidden group-hover:block absolute left-0 top-full mt-0 pt-2 w-48 z-[999]">
                                        <div class="bg-white border border-gray-100 shadow-2xl rounded-lg py-1 overflow-hidden">
                                            <div class="px-3 py-1.5 text-[9px] font-bold text-gray-400 border-b border-gray-50 bg-gray-50/50">Select Tag</div>
                                            <div class="max-h-40 overflow-y-auto">
                                                ${customTagsList.length > 0 ? customTagsList.map(tag => {
                                                    const isPicked = storyTags.includes(tag);
                                                    return `
                                                    <button 
                                                        onclick="tagManager.toggleTagInStory('${s.id}', '${tag}')"
                                                        class="w-full text-left px-3 py-2 text-[11px] font-medium ${isPicked ? 'bg-purple-50 text-purple-700' : 'text-slate-600 hover:bg-indigo-50 hover:text-indigo-600'} transition-colors flex items-center justify-between">
                                                        ${tag}
                                                        ${isPicked ? '<span class="text-purple-600 font-bold">✓</span>' : ''}
                                                    </button>`;
                                                }).join('') : '<div class="px-3 py-2 text-[10px] text-gray-400">No tags defined</div>'}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <h3 onclick="ui.openStoryModal('${s.id}')" class="text-lg font-bold text-slate-800 mb-1 leading-tight cursor-pointer">${s.title}</h3>

                            <div class="grid grid-cols-2 gap-4 py-4 border-t border-gray-50 mt-4">
                                <div>
                                    <div class="flex items-center gap-2 mb-1">
                                        <div class="w-2.5 h-2.5 rounded-full ${devLightColor}"></div>
                                        <p class="text-[10px] uppercase text-gray-400 font-bold">Development</p>
                                    </div>
                                    <div class="flex flex-col gap-0.5">
                                        <p class="text-sm font-medium text-slate-700 flex items-center gap-2">
                                            <span class="w-6 h-6 rounded-full bg-slate-100 flex items-center justify-center text-[10px]">🛠</span> ${s.assignedTo}
                                        </p>
                                        <div class="ml-8 mt-1">
                                            <div class="flex justify-between items-center mb-0.5">
                                                <span class="text-[9px] text-gray-400 font-bold">Tasks: ${completedDevTasks}/${totalDevTasks}</span>
                                                <span class="text-[9px] text-blue-600 font-bold">${devProgressPercent}%</span>
                                            </div>
                                            <div class="w-full bg-gray-100 h-1 rounded-full overflow-hidden mb-1">
                                                <div class="bg-blue-500 h-full" style="width: ${devProgressPercent}%"></div>
                                            </div>
                                            ${totalBugs > 0 ? `
                                            <div class="mb-1">
                                                <div class="flex justify-between items-center mb-0.5">
                                                    <span class="text-[9px] text-gray-400 font-bold">Bugs: ${completedBugs}/${totalBugs}</span>
                                                    <span class="text-[9px] text-red-600 font-bold">${bugProgressPercent}%</span>
                                                </div>
                                                <div class="w-full bg-gray-100 h-1 rounded-full overflow-hidden">
                                                    <div class="bg-red-500 h-full" style="width: ${bugProgressPercent}%"></div>
                                                </div>
                                                ${totalBugEffort > 0 ? `
                                                <div class="flex justify-between items-center mt-1 text-[10px] text-gray-500">
                                                    <span class="font-bold">Bug Effort:</span>
                                                    <span class="font-mono">${remainingBugEffort.toFixed(1)}/${totalBugEffort.toFixed(1)}h</span>
                                                    <span class="text-xs font-bold ${remainingBugEffort === 0 ? 'text-green-600' : 'text-amber-600'}">
                                                        ${bugProgressPercent}%
                                                    </span>
                                                </div>
                                                ` : ''}
                                            </div>
                                            ` : ''}
                                            <p class="text-[10px] text-gray-500 mt-1 font-medium">Start: ${devStartDisplay}</p>
                                            ${devVacDaysNow > 0 ? `<p class="text-[10px] text-orange-600 font-bold">🏖 Vac (Now): ${devVacDaysNow} Days</p>` : ''}
                                            <p class="text-[10px] text-green-600 font-bold">Resolved: ${devResolveDate}</p>
                                            <p class="text-[10px] text-indigo-600 font-bold">Est: ${totalDevEffort}h</p>
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
                                            <span class="w-6 h-6 rounded-full bg-slate-100 flex items-center justify-center text-[10px]">🔍</span> ${s.tester}
                                        </p>
                                        <div class="ml-8 mt-1">
                                            <div class="flex justify-between items-center mb-0.5">
                                                <span class="text-[9px] text-gray-400 font-bold">TCs: ${completedTC}/${totalTC}</span>
                                                <span class="text-[9px] text-indigo-600 font-bold">${progressPercent}%</span>
                                            </div>
                                            <div class="w-full bg-gray-100 h-1 rounded-full overflow-hidden mb-1">
                                                <div class="bg-indigo-500 h-full" style="width: ${progressPercent}%"></div>
                                            </div>
                                            <p class="text-[10px] text-gray-500 mt-1 font-medium">Start: ${testStartDisplay}</p>
                                            ${testVacDaysNow > 0 ? `<p class="text-[10px] text-orange-600 font-bold">🏖 Vac (Now): ${testVacDaysNow} Days</p>` : ''}
                                            <p class="text-[10px] text-indigo-600 font-bold">Est QA: ${totalTestEffort}h</p>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div class="mt-2 pt-4 border-t border-gray-50 bg-slate-50/30 -mx-5 px-5">
                                <label class="text-[10px] font-black text-gray-400 uppercase tracking-wider mb-2 block">Standup Updates</label>
                                
                                <div class="flex gap-2 mb-3">
                                    <input type="text" 
                                           placeholder="Add comment and press Enter..." 
                                           class="flex-1 text-[11px] p-2 bg-white border border-gray-200 rounded-lg focus:ring-1 focus:ring-indigo-500 outline-none"
                                           onkeypress="if(event.key === 'Enter') { commentManager.updateComment('${s.id}', this.value); this.value=''; }">
                                </div>

                                <div class="space-y-2 max-h-28 overflow-y-auto pr-1">
                                    ${comments.slice().reverse().map(c => `
                                        <div class="bg-white p-2 rounded-lg border border-indigo-100/50 shadow-sm">
                                            <div class="flex justify-between items-center mb-1">
                                                <span class="text-[9px] font-bold text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded">${c.date}</span>
                                            </div>
                                            <p class="text-[11px] text-slate-600 leading-tight italic">"${c.text}"</p>
                                        </div>
                                    `).join('')}
                                    ${comments.length === 0 ? '<p class="text-[10px] text-gray-400 italic py-1">No updates recorded yet.</p>' : ''}
                                </div>
                            </div>
                        </div>

                        <div class="${isLate ? 'bg-red-50' : 'bg-slate-50'} p-4 flex justify-between items-center border-t border-gray-100">
                            <div class="flex flex-col">
                                <span class="text-[10px] uppercase font-bold text-gray-400">Target Delivery</span>
                                <span class="text-sm font-bold ${isLate ? 'text-red-600' : 'text-slate-700'}">
                                    ${s.calc.finalEnd instanceof Date ? s.calc.finalEnd.toLocaleDateString('en-GB') : 'Waiting'}
                                </span>
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
        
        // Combine current stories (non-backlog) and backlog stories for filtering
        const allStories = [...currentData.filter(s => !isBacklogStory(s)), ...db.backlogStories];
        if (allStories.length === 0) return;

        const areas = [...new Set(allStories.map(s => s.area || "General"))].sort();
        
        const currentSelected = Array.from(filterSelect.selectedOptions).map(opt => opt.value);
        filterSelect.multiple = true;
        filterSelect.size = Math.min(areas.length, 5);

        filterSelect.innerHTML = areas.map(a => {
            const selected = currentSelected.includes(a) ? 'selected' : '';
            return `<option value="${a}" ${selected}>${a}</option>`;
        }).join('');

        filterSelect.onchange = () => {
            this.renderKanban();
        };

        let selectedAreas = Array.from(filterSelect.selectedOptions).map(opt => opt.value);
        if (selectedAreas.length === 0) {
            selectedAreas = areas;
        }

        const filteredStories = allStories.filter(s => selectedAreas.includes(s.area || "General"));

        // Define columns: Backlog first, then the rest
        const states = ["Backlog", "Active", "Active - With Bugs", "Resolved", "Tested", "On-Hold"];

        container.innerHTML = states.map(state => {
            let storiesInState;
            if (state === "Backlog") {
                // Only backlog stories
                storiesInState = filteredStories.filter(s => isBacklogStory(s));
            } else {
                // Non-backlog stories with matching state
                storiesInState = filteredStories.filter(s => !isBacklogStory(s) && s.state === state);
            }
            
            const columnColor = state === "Backlog" ? "bg-purple-50 border-purple-200" : "bg-gray-50 border-gray-200";
            const headerColor = state === "Backlog" ? "bg-purple-100 text-purple-800" : "bg-gray-100 text-gray-700";
            
            return `
                <div class="flex-shrink-0 w-80 ${columnColor} rounded-xl border flex flex-col max-h-screen">
                    <div class="p-3 border-b flex justify-between items-center bg-white rounded-t-xl">
                        <h3 class="font-bold ${state === 'Backlog' ? 'text-purple-700' : 'text-slate-700'}">${state}</h3>
                        <span class="bg-gray-200 text-gray-700 text-xs px-2 py-0.5 rounded-full">${storiesInState.length}</span>
                    </div>
                    <div class="p-2 space-y-3 overflow-y-auto">
                        ${storiesInState.map(s => {
                            if (isBacklogStory(s)) {
                                // Backlog card - simplified
                                const tagsList = s.tags || [];
                                return `
                                    <div class="bg-white p-3 rounded-lg shadow-sm border border-purple-200 hover:shadow-md transition">
                                        ${tagsList.length > 0 ? `
                                        <div class="flex flex-wrap gap-1 mb-2">
                                            ${tagsList.map(tag => `<span class="bg-purple-50 text-purple-600 text-[8px] font-bold px-1.5 py-0.5 rounded uppercase tracking-tighter">${tag.trim()}</span>`).join('')}
                                        </div>` : ''}
                                        <div class="flex justify-between items-center mb-2">
                                            <div onclick="ui.openStoryModal('${s.id}')" class="text-[10px] font-bold text-purple-600 cursor-pointer hover:underline">#${s.id} 🔍</div>
                                        </div>
                                        <div class="text-sm font-semibold text-slate-800 mb-2 line-clamp-2">${s.title}</div>
                                        <div class="grid grid-cols-2 gap-2 border-t pt-2 text-[11px]">
                                            <div>
                                                <div class="text-gray-400 uppercase font-bold text-[9px]">Area</div>
                                                <div class="text-slate-700 truncate">${s.area}</div>
                                            </div>
                                            <div>
                                                <div class="text-gray-400 uppercase font-bold text-[9px]">Priority</div>
                                                <div class="text-slate-700 font-bold">P${s.priority}</div>
                                            </div>
                                        </div>
                                        ${s.expectedRelease ? `
                                        <div class="mt-2 text-[10px] text-purple-600 border-t border-purple-100 pt-1">
                                            📅 Release: ${s.expectedRelease.toLocaleDateString('en-GB')}
                                        </div>` : ''}
                                    </div>
                                `;
                            }

                            // Regular story card (existing logic)
                            const devTasks = s.tasks.filter(t => ["Development", "DB Modification"].includes(t['Activity']));
                            const devEstTotal = devTasks.reduce((acc, t) => acc + parseFloat(t['Original Estimation'] || 0), 0);
                            const devEstCompleted = devTasks.filter(t => !['New', 'Active'].includes(t['State']))
                                                                            .reduce((acc, t) => acc + parseFloat(t['Original Estimation'] || 0), 0);
                            const devEstRemaining = Math.max(0, devEstTotal - devEstCompleted);

                            const testEst = s.tasks.filter(t => t['Activity'] === 'Testing')
                                                                  .reduce((acc, t) => acc + parseFloat(t['Original Estimation'] || 0), 0);
                            
                            const tagsList = s.tags ? (typeof s.tags === 'string' ? s.tags.split(';') : s.tags) : [];

                            const totalBugs = s.bugs ? s.bugs.length : 0;
                            const completedBugs = s.bugs ? s.bugs.filter(b => ['Closed', 'Resolved', 'Cancel'].includes(b['State'])).length : 0;

                            const totalBugEffort = s.bugs ? s.bugs.reduce((acc, b) => acc + parseFloat(b['Original Estimation'] || 0), 0) : 0;
                            const completedBugEffort = s.bugs ? s.bugs.filter(b => ['Closed', 'Resolved'].includes(b['State']))
                                                                              .reduce((acc, b) => acc + parseFloat(b['Original Estimation'] || 0), 0) : 0;
                            const remainingBugEffort = Math.max(0, totalBugEffort - completedBugEffort);
                            const bugProgressPercent = totalBugEffort > 0 ? Math.round((completedBugEffort / totalBugEffort) * 100) : 0;

                            const testCases = s.testCases || [];
                            const totalTC = testCases.length;
                            const completedTC = testCases.filter(tc => ['Pass', 'Fail', 'Not Applicable'].includes(tc.state)).length;

                            const commentsCount = s.standupComments ? s.standupComments.length : 0;

                            return `
                                <div class="bg-white p-3 rounded-lg shadow-sm border border-gray-100 hover:shadow-md transition">
                                    ${tagsList.length > 0 ? `
                                    <div class="flex flex-wrap gap-1 mb-2">
                                        ${tagsList.map(tag => `<span class="bg-slate-100 text-slate-500 text-[8px] font-bold px-1.5 py-0.5 rounded uppercase tracking-tighter">${tag.trim()}</span>`).join('')}
                                    </div>` : ''}

                                    <div class="flex justify-between items-center mb-2">
                                        <div onclick="ui.openStoryModal('${s.id}')" class="text-[10px] font-bold text-blue-600 cursor-pointer hover:underline flex items-center gap-0.5">#${s.id} 🔍</div>
                                        <button onclick="ui.openCommentsModal('${s.id}')" class="text-[10px] bg-indigo-50 text-indigo-600 px-2 py-1 rounded hover:bg-indigo-100 transition flex items-center gap-1 border border-indigo-100" title="Standup Comments">
                                            💬 <span class="font-bold">${commentsCount}</span>
                                        </button>
                                    </div>
                                    
                                    <div onclick="ui.openStoryModal('${s.id}')" class="text-sm font-semibold text-slate-800 mb-3 line-clamp-2 cursor-pointer hover:text-indigo-600 transition">${s.title}</div>
                                    
                                    <div class="grid grid-cols-2 gap-2 border-t pt-2">
                                        <div class="text-[11px]">
                                            <div class="text-gray-400 uppercase font-bold text-[9px]">Dev</div>
                                            <div class="text-slate-700 truncate font-medium">${s.assignedTo}</div>
                                            <div class="flex justify-between items-center mt-1">
                                                <span class="text-blue-500 font-bold" title="Remaining / Total Estimation">${devEstRemaining}/${devEstTotal}h</span>
                                                <span class="text-red-500 text-[10px] font-bold" title="Completed Bugs">🐞${completedBugs}/${totalBugs}</span>
                                            </div>
                                            ${totalBugEffort > 0 ? `
                                            <div class="flex justify-between items-center mt-1 text-[10px] text-gray-600 border-t border-dashed border-gray-200 pt-1">
                                                <span class="font-bold text-gray-500">Bug Effort:</span>
                                                <span class="font-mono">${remainingBugEffort.toFixed(1)}/${totalBugEffort.toFixed(1)}h</span>
                                                <span class="text-xs font-bold ${remainingBugEffort === 0 ? 'text-green-600' : 'text-amber-600'}">
                                                    ${bugProgressPercent}%
                                                </span>
                                            </div>
                                            <div class="w-full bg-gray-200 h-0.5 rounded-full mt-0.5">
                                                <div class="${remainingBugEffort === 0 ? 'bg-green-500' : 'bg-amber-500'} h-full rounded-full" style="width: ${bugProgressPercent}%"></div>
                                            </div>
                                            ` : ''}
                                        </div>
                                        <div class="text-[11px] border-l pl-2">
                                            <div class="text-gray-400 uppercase font-bold text-[9px]">Tester</div>
                                            <div class="text-slate-700 truncate font-medium">${s.tester}</div>
                                            <div class="flex justify-between items-center mt-1">
                                                <span class="text-green-500 font-bold">${testEst}h</span>
                                                <span class="text-indigo-500 text-[10px] font-bold" title="Completed Test Cases">📋${completedTC}/${totalTC}</span>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            `;
                        }).join('')}
                        ${storiesInState.length === 0 ? '<div class="text-center py-10 text-gray-300 text-sm italic">Empty column</div>' : ''}
                    </div>
                </div>
            `;
        }).join('');
    },

    renderDelivery() {
        const container = document.getElementById('delivery-grid');
        const searchTerm = document.getElementById('search-delivery-input')?.value.toLowerCase() || ""; 
        
        // Exclude backlog from delivery
        const nonBacklog = currentData.filter(s => !isBacklogStory(s));
        const allTested = nonBacklog.filter(s => s.state === 'Tested' || s.state === 'Closed');

        const pendingStories = allTested.filter(s => {
            const isPending = !db.deliveryLogs.some(l => l.storyId === s.id.toString());
            const matchesSearch = 
                s.title.toLowerCase().includes(searchTerm) || 
                s.id.toString().includes(searchTerm) || 
                (s.area && s.area.toLowerCase().includes(searchTerm));
            return isPending && matchesSearch;
        });

        const completedStories = db.deliveryLogs.map(log => {
            const story = currentData.find(s => s.id.toString() === log.storyId.toString());
            return { 
                ...story, 
                logData: log,
                title: story ? story.title : "Story not in current CSV",
                area: story ? story.area : "N/A"
            };
        }).filter(s => {
            const matchesSearch = 
                s.title.toLowerCase().includes(searchTerm) || 
                s.logData.storyId.toString().includes(searchTerm) || 
                s.logData.to.toLowerCase().includes(searchTerm) ||
                (s.area && s.area.toLowerCase().includes(searchTerm));
            return matchesSearch;
        }).reverse();

        if (pendingStories.length === 0 && completedStories.length === 0) {
            container.innerHTML = `<div class="col-span-full text-center py-10 text-gray-400">
                ${searchTerm ? 'لا توجد نتائج تطابق بحثك في قسم التسليم.' : 'لا توجد عناصر حالياً.'}
            </div>`;
            return;
        }

        const createCardHtml = (s, isLogged) => {
            return `
                <div class="bg-white p-4 rounded-xl border-2 transition-all ${isLogged ? 'border-gray-100 shadow-none' : 'border-blue-200 shadow-sm hover:border-blue-400'}">
                    <div class="flex justify-between items-start mb-2">
                        <span class="text-[10px] font-mono text-gray-400">#${isLogged ? s.logData.storyId : s.id}</span>
                    </div>
                    <div class="font-bold text-slate-800 mb-4 leading-snug">${s.title}</div>
                    <span class="text-xs font-bold ${isLogged ? 'text-green-500' : 'text-blue-500 italic'}">
                        ${isLogged ? '✓ تم التسليم' : '*Tested*'}
                    </span>
                    <div class="text-[10px] text-gray-500 mb-2 italic">Area: ${s.area || "General"}</div>
                    
                    ${isLogged ? `
                        <div class="relative group mt-2" dir="rtl">
                            <div class="text-xs bg-green-50 text-green-700 p-3 pr-12 rounded-lg border border-green-100 min-h-[60px] leading-relaxed">
                                <b>المستلم:</b> ${s.logData.to}<br>
                                <b>التاريخ:</b> ${s.logData.date}
                            </div>
                            ${currentUser && currentUser.role === 'admin' ? `
                                <button onclick="ui.editDelivery('${s.logData.storyId}')" 
                                        class="absolute top-2 left-2 bg-white border border-green-200 shadow-sm text-gray-500 hover:text-blue-600 hover:border-blue-300 rounded-md p-1.5 text-[10px] transition-all z-10 flex items-center gap-1"
                                        title="تعديل">
                                    <span>✏️</span>
                                    <span class="text-[9px] font-bold">تعديل</span>
                                </button>
                            ` : ''}
                        </div>
                    ` : (currentUser && currentUser.role === 'admin' ? `
                        <div class="flex gap-2 mt-auto">
                            <input id="to-${s.id}" placeholder="اسم المستلم..." class="text-xs border border-gray-200 p-2 rounded-lg flex-1 focus:ring-1 focus:ring-blue-500 outline-none">
                            <button onclick="ui.markDelivered('${s.id}')" class="bg-blue-600 hover:bg-blue-700 text-white px-3 py-2 rounded-lg text-xs font-bold transition-colors">
                                تأكيد
                            </button>
                        </div>
                    ` : `<div class="text-xs text-gray-400 italic mt-auto">بانتظار تأكيد التسليم من الأدمن</div>`)}
                </div>
            `;
        };

        let html = `
            <div class="col-span-full mb-4">
                <h3 class="text-lg font-bold text-blue-700 flex items-center gap-2">
                    📦 بانتظار التسليم (${pendingStories.length})
                </h3>
            </div>
            ${pendingStories.map(s => createCardHtml(s, false)).join('') || '<div class="col-span-full text-center text-gray-400 py-4">لا توجد نتائج</div>'}

            <div class="col-span-full my-8 border-t-2 border-dashed border-gray-200"></div>

            <div class="col-span-full mb-4">
                <h3 class="text-lg font-bold text-gray-500 flex items-center gap-2">
                    ✅ تم التسليم مؤخراً (${completedStories.length})
                </h3>
            </div>
            ${completedStories.map(s => createCardHtml(s, true)).join('') || '<div class="col-span-full text-center text-gray-400 py-4">لا توجد نتائج</div>'}
        `;

        container.innerHTML = html;
    },

    markDelivered(id) {
        if (currentUser.role !== 'admin') {
            alert("عذراً، لا تملك صلاحية تنفيذ هذا الإجراء.");
            return;
        }
        const to = document.getElementById(`to-${id}`).value;
        if(!to) return alert("اكتب المستلم");
        db.deliveryLogs.push({
            storyId: id, to, date: new Date().toLocaleDateString(), timestamp: Date.now()
        });
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
                    if (input) {
                        input.focus();
                        input.classList.add('ring-2', 'ring-orange-400');
                    }
                }, 100);
            });
        }
    },

    renderWorkload() {
        const container = document.getElementById('workload-container');
        if (!container) return;

        // Exclude backlog from workload
        const nonBacklog = currentData.filter(s => !isBacklogStory(s));
        const areaGroups = {};
        const MAX_HOURS = 65;

        const globalTaskWorkers = new Set();
        nonBacklog.forEach(story => {
            const activeTasks = (story.tasks || []).filter(t => 
                t['State'] !== 'To Be Reviewed' && t['State'] !== 'Closed' && 
                parseFloat(t['Original Estimation'] || 0) > 0
            );
            activeTasks.forEach(t => {
                const worker = (t['Activity'] === 'Testing') ? story.tester : story.assignedTo;
                if (worker && worker !== "Unassigned") globalTaskWorkers.add(worker);
            });
        });

        const supportWorkersGlobal = new Set();
        const bugWorkersGlobal = new Set();

        nonBacklog.forEach(story => {
            if (story.type === 'Support Log' && story.state !== 'Tested' && story.state !== 'Closed') {
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
            if (!areaGroups[area]) {
                areaGroups[area] = { 
                    developers: {},
                    testers: {},
                    allDevsInArea: new Set(),
                    allTestersInArea: new Set(),
                    activeDevStories: {},
                    activeTesterStories: {}
                };
            }

            if (story.assignedTo && story.assignedTo !== "Unassigned") areaGroups[area].allDevsInArea.add(story.assignedTo);
            if (story.tester && story.tester !== "Unassigned") areaGroups[area].allTestersInArea.add(story.tester);

            const isActiveStory = story.state !== 'Tested' && story.state !== 'Closed';
            if (isActiveStory && (story.type === 'User Story' || story.type === 'CR')) {
                if (story.assignedTo && story.assignedTo !== "Unassigned") {
                    areaGroups[area].activeDevStories[story.assignedTo] = 
                        (areaGroups[area].activeDevStories[story.assignedTo] || 0) + 1;
                }
                if (story.tester && story.tester !== "Unassigned") {
                    areaGroups[area].activeTesterStories[story.tester] = 
                        (areaGroups[area].activeTesterStories[story.tester] || 0) + 1;
                }
            }

            const activeDevTasks = (story.tasks || []).filter(t => 
                ["Development", "DB Modification"].includes(t['Activity']) && 
                t['State'] !== 'To Be Reviewed' && t['State'] !== 'Closed'
            );
            const dHours = activeDevTasks.reduce((acc, t) => acc + parseFloat(t['Original Estimation'] || 0), 0);
            if (dHours > 0) {
                areaGroups[area].developers[story.assignedTo] = (areaGroups[area].developers[story.assignedTo] || 0) + dHours;
            }

            const activeTestTasks = (story.tasks || []).filter(t => 
                t['Activity'] === 'Testing' && 
                t['State'] !== 'To Be Reviewed' && t['State'] !== 'Closed'
            );
            const tHours = activeTestTasks.reduce((acc, t) => acc + parseFloat(t['Original Estimation'] || 0), 0);
            if (tHours > 0) {
                areaGroups[area].testers[story.tester] = (areaGroups[area].testers[story.tester] || 0) + tHours;
            }
        });

        const renderAvailableTag = (name) => {
            const isBusyGlobally = globalTaskWorkers.has(name);
            return `
                <span class="px-3 py-1.5 bg-white border border-slate-200 text-slate-600 text-[10px] font-bold rounded-full shadow-sm hover:border-emerald-300 hover:text-emerald-600 transition-colors flex items-center gap-1.5">
                    ${name}
                    ${isBusyGlobally ? '<span class="text-[8px] bg-amber-100 text-amber-600 px-1.5 py-0.5 rounded shadow-sm font-black ring-1 ring-amber-200">BUSY</span>' : ''}
                </span>`;
        };

        const areaEntries = Object.entries(areaGroups);

        container.innerHTML = areaEntries.map(([areaName, data], index) => {
            const activeDevs = Object.keys(data.activeDevStories).filter(name => data.activeDevStories[name] > 0);
            const activeDevsCount = activeDevs.length;

            const storiesInArea = nonBacklog.filter(s => (s.area || "General Business Area") === areaName);
            const testerStoriesCount = {};
            storiesInArea.forEach(s => {
                const isRelevant = s.state === 'Resolved' || s.state === 'Active' || s.state === 'Active - With Bugs';
                if (isRelevant && s.tester && s.tester !== "Unassigned") {
                    testerStoriesCount[s.tester] = (testerStoriesCount[s.tester] || 0) + 1;
                }
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
                if (supportWorkersGlobal.has(worker)) {
                    supportWorkersInArea.push(worker);
                } else if (bugWorkersGlobal.has(worker)) {
                    bugWorkersInArea.push(worker);
                }
            });

            const availableDevs = [...data.allDevsInArea]
                .filter(name => !data.developers[name])
                .filter(name => !supportWorkersGlobal.has(name) && !bugWorkersGlobal.has(name));

            const availableTesters = [...data.allTestersInArea]
                .filter(name => !data.testers[name])
                .filter(name => !supportWorkersGlobal.has(name) && !bugWorkersGlobal.has(name));

            const finalAvailableDevs = availableDevs.filter(name => !availableTesters.includes(name));

            return `
                <div class="mb-16 bg-white rounded-[3rem] shadow-2xl shadow-slate-200/50 overflow-hidden border border-slate-100 cursor-move transition-all duration-300 hover:shadow-indigo-100/50"
                     draggable="true"
                     ondragstart="ui.handleAreaDragStart(event, ${index})"
                     ondragover="ui.handleAreaDragOver(event)"
                     ondrop="ui.handleAreaDrop(event, ${index})">
                    
                    <div class="bg-gradient-to-r from-slate-800 to-slate-900 p-6 px-10 flex justify-between items-center pointer-events-none">
                        <div>
                            <h2 class="text-2xl font-black text-white tracking-tight flex items-center gap-3">
                                <span class="w-4 h-4 bg-indigo-500 rounded-full shadow-[0_0_10px_rgba(99,102,241,0.8)]"></span>
                                ${areaName}
                            </h2>
                            <p class="text-slate-400 text-[10px] uppercase tracking-[0.2em] font-bold mt-1">Resource Allocation & Availability</p>
                        </div>
                        <i class="fas fa-grip-vertical text-slate-600 text-xl"></i>
                    </div>

                    <div class="px-10 py-3 bg-slate-50/80 border-b border-slate-200 space-y-1.5">
                        <div class="flex items-center gap-2 text-xs">
                            <span class="font-bold text-slate-600 w-24">Dev WIP (Active):</span>
                            <span class="font-mono font-black text-indigo-700 w-10">${devWipLimit}</span>
                            <span class="font-mono font-black ${devActiveCount > devWipLimit ? 'text-red-600' : 'text-slate-700'} w-10">${devActiveCount}</span>
                            <div class="flex-1 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                                <div class="${devWipUsage > 80 ? 'bg-amber-500' : 'bg-emerald-500'} h-full rounded-full transition-all duration-1000" style="width: ${devWipUsage}%"></div>
                            </div>
                            <span class="text-[10px] text-slate-400 font-mono w-10">${Math.round(devWipUsage)}%</span>
                        </div>
                        <div class="flex items-center gap-2 text-xs">
                            <span class="font-bold text-slate-600 w-24">QA WIP (Resolved):</span>
                            <span class="font-mono font-black text-purple-700 w-10">${testerWipLimit}</span>
                            <span class="font-mono font-black ${resolvedStoriesCount > testerWipLimit ? 'text-red-600' : 'text-slate-700'} w-10">${resolvedStoriesCount}</span>
                            <div class="flex-1 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                                <div class="${testerWipUsage > 80 ? 'bg-amber-500' : 'bg-purple-500'} h-full rounded-full transition-all duration-1000" style="width: ${testerWipUsage}%"></div>
                            </div>
                            <span class="text-[10px] text-slate-400 font-mono w-10">${Math.round(testerWipUsage)}%</span>
                        </div>
                        <div class="text-[10px] text-slate-400 pt-0.5">
                            <span class="font-bold">${activeDevsCount}</span> Devs · <span class="font-bold">${activeTestersCount}</span> Testers
                        </div>
                    </div>

                    <div class="p-10 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-8 pointer-events-none">
                        <!-- Active Developers -->
                        <div class="space-y-6">
                            <div class="flex items-center gap-2 pb-2 border-b-2 border-indigo-100">
                                <i class="fas fa-code text-indigo-600"></i>
                                <h3 class="text-slate-800 font-black text-sm uppercase">Active Developers</h3>
                            </div>
                            ${this.generateStaffBarsWithCount(data.developers, 'indigo', MAX_HOURS, data.activeDevStories)}
                        </div>

                        <!-- Active Testers -->
                        <div class="space-y-6">
                            <div class="flex items-center gap-2 pb-2 border-b-2 border-emerald-100">
                                <i class="fas fa-vial text-emerald-600"></i>
                                <h3 class="text-slate-800 font-black text-sm uppercase">Active Testers</h3>
                            </div>
                            ${this.generateStaffBarsWithCount(data.testers, 'emerald', MAX_HOURS, data.activeTesterStories)}
                        </div>

                        <!-- Working On Support + Working On Bugs -->
                        <div class="space-y-6">
                            <div>
                                <div class="flex items-center gap-2 pb-2 border-b-2 border-amber-100">
                                    <i class="fas fa-headset text-amber-600"></i>
                                    <h3 class="text-slate-800 font-black text-sm uppercase">Working On Support</h3>
                                </div>
                                <div class="space-y-3 mt-3">
                                    ${supportWorkersInArea.length > 0 ? supportWorkersInArea.map(worker => `
                                        <div class="flex items-center justify-between p-3 bg-amber-50 rounded-xl border border-amber-100">
                                            <div class="flex items-center gap-3">
                                                <div class="w-8 h-8 rounded-full bg-white flex items-center justify-center text-amber-600 font-bold text-xs border border-amber-200">
                                                    ${worker.charAt(0)}
                                                </div>
                                                <div>
                                                    <div class="text-xs font-bold text-slate-700">${worker}</div>
                                                    <div class="text-[9px] text-amber-600 uppercase font-bold">Support</div>
                                                </div>
                                            </div>
                                            <span class="text-[10px] bg-amber-200 text-amber-800 px-2 py-0.5 rounded-full font-bold">Active</span>
                                        </div>
                                    `).join('') : '<div class="text-slate-400 text-xs italic p-4 text-center">No active support</div>'}
                                </div>
                            </div>

                            <div>
                                <div class="flex items-center gap-2 pb-2 border-b-2 border-rose-100">
                                    <i class="fas fa-bug text-rose-600"></i>
                                    <h3 class="text-slate-800 font-black text-sm uppercase">Working On Bugs</h3>
                                </div>
                                <div class="space-y-3 mt-3">
                                    ${bugWorkersInArea.length > 0 ? bugWorkersInArea.map(worker => `
                                        <div class="flex items-center justify-between p-3 bg-rose-50 rounded-xl border border-rose-100">
                                            <div class="flex items-center gap-3">
                                                <div class="w-8 h-8 rounded-full bg-white flex items-center justify-center text-rose-600 font-bold text-xs border border-rose-200">
                                                    ${worker.charAt(0)}
                                                </div>
                                                <div>
                                                    <div class="text-xs font-bold text-slate-700">${worker}</div>
                                                    <div class="text-[9px] text-rose-600 uppercase font-bold">Bugs</div>
                                                </div>
                                            </div>
                                            <span class="text-[10px] bg-rose-200 text-rose-800 px-2 py-0.5 rounded-full font-bold">Active</span>
                                        </div>
                                    `).join('') : '<div class="text-slate-400 text-xs italic p-4 text-center">No active bugs</div>'}
                                </div>
                            </div>
                        </div>

                        <!-- Available For Tasks -->
                        <div class="bg-slate-50 rounded-3xl p-6 border-2 border-dashed border-slate-200">
                            <div class="flex items-center gap-2 mb-4">
                                <div class="w-8 h-8 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-600">
                                    <i class="fas fa-user-check text-xs"></i>
                                </div>
                                <h3 class="text-slate-800 font-black text-sm uppercase">Available For Tasks</h3>
                            </div>

                            <div class="mb-5">
                                <p class="text-[9px] font-bold text-indigo-600 uppercase mb-2 tracking-widest flex items-center gap-2">
                                    <i class="fas fa-code text-[10px]"></i> Developers
                                </p>
                                <div class="flex flex-wrap gap-2">
                                    ${finalAvailableDevs.length > 0 
                                        ? finalAvailableDevs.map(name => renderAvailableTag(name)).join('') 
                                        : '<span class="text-[10px] text-slate-300 italic">No available developers</span>'}
                                </div>
                            </div>

                            <div>
                                <p class="text-[9px] font-bold text-purple-600 uppercase mb-2 tracking-widest flex items-center gap-2">
                                    <i class="fas fa-vial text-[10px]"></i> Testers
                                </p>
                                <div class="flex flex-wrap gap-2">
                                    ${availableTesters.length > 0 
                                        ? availableTesters.map(name => renderAvailableTag(name)).join('') 
                                        : '<span class="text-[10px] text-slate-300 italic">No available testers</span>'}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            `;
        }).join('');

        const activeTab = document.querySelector('.tab-content.active');
        if (activeTab && activeTab.id === 'tab-workload') {
            const allFreeDevs = [];
            areaEntries.forEach(([areaName, data]) => {
                const freeDevsInArea = [...data.allDevsInArea]
                    .filter(name => !data.developers[name])
                    .filter(name => !supportWorkersGlobal.has(name))
                    .filter(name => !bugWorkersGlobal.has(name))
                    .filter(name => !globalTaskWorkers.has(name))
                    .filter(name => !data.allTestersInArea.has(name));

                if (freeDevsInArea.length > 0) {
                    allFreeDevs.push({ area: areaName, devs: freeDevsInArea });
                }
            });

            if (allFreeDevs.length > 0) {
                this.showFreeDevelopersPopup(allFreeDevs);
            }
        }
    },

    generateStaffBarsWithCount(staffData, color, max, storyCounts) {
        const entries = Object.entries(staffData);
        if (entries.length === 0) return `<div class="text-gray-300 text-sm italic">No active tasks</div>`;

        return entries.sort((a,b) => b[1] - a[1]).map(([name, hours]) => {
            const perc = Math.min((hours / max) * 100, 100);
            const isOver = hours > max;
            const barColor = isOver ? 'bg-red-500' : (perc > 80 ? 'bg-orange-500' : `bg-${color}-500`);
            const storyCount = storyCounts[name] || 0;

            return `
                <div class="relative p-3 bg-slate-50/50 rounded-2xl border border-slate-100 hover:bg-slate-50 transition-colors">
                    <div class="flex justify-between mb-2 items-start">
                        <span class="font-bold text-sm text-slate-700">
                            ${name} 
                            <span class="text-[10px] font-normal text-gray-400">(${storyCount} ${storyCount === 1 ? 'story' : 'stories'})</span>
                        </span>
                        <span class="text-xs font-mono ${isOver ? 'text-red-600 font-black' : 'text-slate-500'}">
                            ${hours.toFixed(1)} <span class="text-[10px] text-slate-400">/ ${max}h</span>
                        </span>
                    </div>
                    <div class="w-full bg-gray-200/70 rounded-full h-2">
                        <div class="${barColor} h-2 rounded-full transition-all duration-1000 shadow-sm" style="width: ${perc}%"></div>
                    </div>
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
                        <button onclick="document.getElementById('free-devs-modal').style.display='none'" 
                                class="text-slate-500 hover:text-red-500 text-2xl font-bold leading-none">&times;</button>
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
                    <h4 class="font-bold text-indigo-600 text-sm border-b pb-1 mb-2">${item.area}</h4>
                    <div class="flex flex-wrap gap-2">
                        ${item.devs.map(name => `<span class="px-3 py-1 bg-emerald-100 text-emerald-700 rounded-full text-xs font-bold border border-emerald-200">${name}</span>`).join('')}
                    </div>
                </div>
            `).join('');
        }

        modal.style.display = 'flex';
    },

    handleAreaDragStart(event, index) {
        event.dataTransfer.setData('text/plain', index);
        setTimeout(() => {
            event.target.classList.add('opacity-40');
        }, 0);
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

        // Keep backlog stories at the end
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
            // Simplified view for backlog stories
            body.innerHTML = `
                <div class="grid grid-cols-2 gap-4 text-sm">
                    <div class="bg-slate-50 p-3 rounded-lg">
                        <p class="text-gray-500 text-xs font-bold uppercase">Business Area</p>
                        <p class="font-semibold text-slate-700">${s.area}</p>
                    </div>
                    <div class="bg-slate-50 p-3 rounded-lg">
                        <p class="text-gray-500 text-xs font-bold uppercase">Priority</p>
                        <p class="font-semibold text-slate-700">P${s.priority}</p>
                    </div>
                </div>
                <div class="bg-purple-50 p-4 rounded-xl border border-purple-200">
                    <div class="flex items-center gap-2 text-purple-700">
                        <span class="text-lg">📋</span>
                        <span class="font-bold">This story is in the Backlog</span>
                    </div>
                    <p class="text-sm text-slate-600 mt-2">State: ${s.state}</p>
                    ${s.expectedRelease ? `<p class="text-sm text-slate-600">Expected Release: ${s.expectedRelease.toLocaleDateString('en-GB')}</p>` : ''}
                    ${s.assignedTo ? `<p class="text-sm text-slate-600">Assigned To: ${s.assignedTo}</p>` : ''}
                </div>
                <div class="mt-6 p-4 bg-indigo-50 rounded-xl border border-indigo-100">
                    <div class="flex justify-between items-center">
                        <span class="text-xs font-bold text-slate-500 uppercase">Client Release Date</span>
                        <span class="text-sm font-bold text-slate-700">${s.expectedRelease instanceof Date ? s.expectedRelease.toLocaleDateString() : 'Not Scheduled'}</span>
                    </div>
                </div>
            `;
        } else {
            // Regular story view
            const nonTestTasks = s.tasks.filter(t => t['Activity'] !== 'Testing' && t['Activity'] !== 'Preparation');
            const testTasks = s.tasks.filter(t => t['Activity'] === 'Testing');

            body.innerHTML = `
                <div class="grid grid-cols-2 gap-4 text-sm">
                    <div class="bg-slate-50 p-3 rounded-lg">
                        <p class="text-gray-500 text-xs font-bold uppercase">Business Area</p>
                        <p class="font-semibold text-slate-700">${s.area}</p>
                    </div>
                    <div class="bg-slate-50 p-3 rounded-lg">
                        <p class="text-gray-500 text-xs font-bold uppercase">Priority</p>
                        <p class="font-semibold text-slate-700">P${s.priority}</p>
                    </div>
                </div>

                <div class="space-y-4">
                    <h4 class="font-bold text-blue-700 border-b pb-1">🛠 Development Details</h4>
                    <div class="grid grid-cols-2 gap-2 text-xs">
                        <p><b>Assigned To:</b> ${s.assignedTo}</p>
                        <p><b>Dev End:</b> ${s.calc.devEnd instanceof Date ? s.calc.devEnd.toLocaleString() : 'TBD'}</p>
                    </div>
                    <div class="space-y-1">
                        ${nonTestTasks.map(t => `
                            <div class="flex justify-between text-[11px] bg-white border p-2 rounded shadow-sm">
                                <span class="flex items-start gap-2">
                                    <span class="font-mono text-blue-600 font-bold bg-blue-50 px-1 rounded">#${t['ID']}</span>
                                    <span>${t['Title']}</span>
                                </span>
                                <span class="px-2 rounded h-fit ${t['State'] === 'Closed' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}">${t['State']}</span>
                            </div>
                        `).join('')}
                    </div>
                </div>

                <div class="space-y-4">
                    <h4 class="font-bold text-purple-700 border-b pb-1">🔍 QA & Testing</h4>
                    <div class="grid grid-cols-2 gap-2 text-xs">
                        <p><b>Tester:</b> ${s.tester}</p>
                        <p><b>Test End:</b> ${s.calc.testEnd instanceof Date ? s.calc.testEnd.toLocaleString() : 'Waiting'}</p>
                    </div>
                    <div class="space-y-1">
                        ${s.testCases && s.testCases.length > 0 ? s.testCases.map(tc => `
                            <div class="flex justify-between text-[11px] bg-white border p-2 rounded shadow-sm">
                                <span>TC #${tc.id}</span>
                                <span class="font-bold ${tc.state === 'Pass' ? 'text-green-600' : 'text-red-600'}">${tc.state}</span>
                            </div>
                        `).join('') : '<p class="text-xs text-gray-400 italic">No test cases linked yet.</p>'}
                    </div>
                </div>

                ${s.bugs && s.bugs.length > 0 ? `
                <div class="space-y-2">
                    <h4 class="font-bold text-red-600 border-b pb-1">🐞 Bugs (${s.bugs.length})</h4>
                    ${s.bugs.map(b => `
                        <div class="text-[11px] border-l-2 border-red-500 pl-2 py-1">
                            <p class="font-bold">${b['Title']}</p>
                            <p class="text-gray-500">State: ${b['State']} | Effort: ${b['Original Estimation']}h</p>
                        </div>
                    `).join('')}
                </div>` : ''}

                <div class="mt-6 p-4 bg-indigo-50 rounded-xl border border-indigo-100">
                    <div class="flex justify-between items-center mb-2">
                        <span class="text-xs font-bold text-indigo-700 uppercase">Internal Delivery Target</span>
                        <span class="text-sm font-bold text-indigo-900">${s.calc.finalEnd instanceof Date ? s.calc.finalEnd.toLocaleString() : 'Calculating...'}</span>
                    </div>
                    <div class="flex justify-between items-center">
                        <span class="text-xs font-bold text-slate-500 uppercase">Client Release Date</span>
                        <span class="text-sm font-bold text-slate-700">${s.expectedRelease instanceof Date ? s.expectedRelease.toLocaleDateString() : 'Not Scheduled'}</span>
                    </div>
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
        
        const comments = s.standupComments || [];

        body.innerHTML = `
            <div class="bg-slate-50/30 px-2">
                <div class="flex gap-2 mb-4">
                    <input type="text" 
                           id="kanban-comment-input"
                           placeholder="Add new update and press Enter..." 
                           class="flex-1 text-sm p-3 bg-white border border-gray-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none shadow-sm"
                           onkeypress="if(event.key === 'Enter') { 
                               commentManager.updateComment('${s.id}', this.value); 
                               this.value=''; 
                               ui.openCommentsModal('${s.id}'); 
                               ui.renderKanban(); 
                           }">
                </div>

                <div class="space-y-3 max-h-[60vh] overflow-y-auto pr-2">
                    ${comments.slice().reverse().map(c => `
                        <div class="bg-white p-3 rounded-xl border border-indigo-100 shadow-sm">
                            <div class="flex justify-between items-center mb-2">
                                <span class="text-[10px] font-bold text-indigo-600 bg-indigo-50 px-2 py-1 rounded">${c.date}</span>
                            </div>
                            <p class="text-sm text-slate-700 leading-relaxed italic">"${c.text}"</p>
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
            html += `<div class="border-b pb-2"><h4 class="font-bold text-indigo-600">${area}</h4>`;
            grouped[area].forEach(s => {
                html += `
                    <div class="flex justify-between items-center border-b border-gray-100 py-1 hover:bg-gray-50 cursor-pointer" onclick="ui.openStoryModal('${s.id}')">
                        <span class="text-sm">#${s.id} - ${s.title}</span>
                        <span class="px-2 py-0.5 rounded-full text-xs font-bold ${s.state === 'Tested' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'}">${s.state}</span>
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
        const nonBacklog = currentData.filter(s => !isBacklogStory(s));
        const activeStories = nonBacklog.filter(s => s.branch === branch && s.state !== 'Tested' && s.state !== 'Closed');
        this.showModalWithTitleAndStories(`Branch: ${branch} (${activeStories.length} active stories)`, activeStories);
    },

    showCustomerModal(customer) {
        const nonBacklog = currentData.filter(s => !isBacklogStory(s));
        const activeStories = nonBacklog.filter(s => s.customer === customer && s.state !== 'Tested' && s.state !== 'Closed');
        this.showModalWithTitleAndStories(`Customer: ${customer} (${activeStories.length} active stories)`, activeStories);
    },

    renderDailyActivity() {
        const container = document.getElementById('daily-activity-container');
        if (!container) return;

        const today = new Date();
        const todayStr = today.toISOString().split('T')[0];
        const activities = [];

        // Exclude backlog from daily activity
        const nonBacklog = currentData.filter(s => !isBacklogStory(s));

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
            container.innerHTML = `<div class="bg-white p-10 rounded-xl border-2 border-dashed border-gray-200 text-center text-gray-400">No updates recorded for today (${todayStr})</div>`;
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
            const branchItemsCount = Object.values(grouped[branch]).reduce((sum, area) => {
                return sum + Object.values(area).reduce((s, cust) => s + cust.length, 0);
            }, 0);

            html += `
            <div class="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                <div class="bg-slate-50 px-4 py-2 border-b border-slate-200 flex justify-between items-center">
                    <span class="font-bold text-slate-700 text-sm"><i class="fas fa-code-branch mr-2 text-indigo-500"></i>${branch}</span>
                    <span class="bg-indigo-600 text-white text-[10px] px-2 py-0.5 rounded-full font-bold">
                        ${branchItemsCount} Today
                    </span>
                </div>
                <div class="p-4 space-y-4">`;

            for (const area in grouped[branch]) {
                html += `<div><h4 class="text-xs font-black text-indigo-600 mb-2 uppercase tracking-tighter italic underline">${area}</h4>`;
                for (const customer in grouped[branch][area]) {
                    html += `<div class="ml-2 mb-3"><div class="text-[11px] font-bold text-slate-400 mb-2 border-l-2 border-slate-200 pl-2 tracking-widest uppercase">Target: ${customer}</div>`;
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
        
        const states = activities.reduce((acc, s) => { 
            acc[s.state] = (acc[s.state] || 0) + 1; 
            return acc; 
        }, {});

        const branchStatsMap = {};
        activities.forEach(s => {
            const branchName = s.branch || "Unknown";
            branchStatsMap[branchName] = (branchStatsMap[branchName] || 0) + 1;
        });
        const branchStats = Object.entries(branchStatsMap)
            .map(([name, count]) => ({ name, count }))
            .sort((a, b) => b.count - a.count);

        const areaStatsMap = {};
        activities.forEach(s => {
            const areaName = s.area || "General";
            areaStatsMap[areaName] = (areaStatsMap[areaName] || 0) + 1;
        });
        const areaStats = Object.entries(areaStatsMap)
            .map(([name, count]) => ({ name, count }))
            .sort((a, b) => b.count - a.count);

        return `
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
            <div class="bg-gradient-to-br from-indigo-600 to-blue-700 p-5 rounded-2xl shadow-lg text-white">
                <div class="text-[10px] opacity-80 font-bold uppercase tracking-widest text-center">Total Daily Activities</div>
                <div class="text-5xl font-black mt-2 text-center">${total}</div>
                <div class="text-[10px] mt-3 bg-white/20 text-center px-2 py-1 rounded-md backdrop-blur-sm">Matching all charts below</div>
            </div>

            <div class="col-span-1 md:col-span-2 bg-white p-4 rounded-2xl shadow-sm border border-slate-100">
                <div class="text-[10px] text-gray-400 font-bold uppercase mb-3">Status Breakdown</div>
                <div class="flex flex-wrap gap-2">
                    ${Object.entries(states).map(([state, count]) => `
                        <div class="bg-slate-50 px-3 py-2 rounded-xl border border-slate-100 flex-1 min-w-[100px]">
                            <div class="text-[9px] font-bold text-slate-500 truncate">${state}</div>
                            <div class="text-lg font-black text-indigo-600">${count}</div>
                        </div>
                    `).join('')}
                </div>
            </div>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
            <div class="bg-white p-4 rounded-2xl shadow-sm border border-slate-100">
                <div class="text-[10px] text-indigo-600 font-bold uppercase mb-2 flex justify-between">
                   <span>📊 Branches Summary</span>
                   <span>Sum: ${branchStats.reduce((a, b) => a + b.count, 0)}</span>
                </div>
                <div class="space-y-3 mt-2">
                    ${branchStats.slice(0, 5).map(branch => {
                        const width = (branch.count / total) * 100;
                        return `
                        <div>
                            <div class="flex justify-between text-[10px] mb-1 font-bold text-slate-600">
                                <span class="truncate pr-2">${branch.name}</span>
                                <span>${branch.count}</span>
                            </div>
                            <div class="w-full bg-slate-100 h-1.5 rounded-full overflow-hidden">
                                <div class="bg-indigo-500 h-full rounded-full" style="width: ${width}%"></div>
                            </div>
                        </div>`;
                    }).join('')}
                </div>
            </div>

            <div class="bg-white p-4 rounded-2xl shadow-sm border border-slate-100">
                <div class="text-[10px] text-purple-600 font-bold uppercase mb-2 flex justify-between">
                   <span>📂 Areas Summary</span>
                   <span>Sum: ${areaStats.reduce((a, b) => a + b.count, 0)}</span>
                </div>
                <div class="space-y-3 mt-2">
                    ${areaStats.slice(0, 5).map(area => {
                        const width = (area.count / total) * 100;
                        return `
                        <div>
                            <div class="flex justify-between text-[10px] mb-1 font-bold text-slate-600">
                                <span class="truncate pr-2">${area.name}</span>
                                <span>${area.count}</span>
                            </div>
                            <div class="w-full bg-slate-100 h-1.5 rounded-full overflow-hidden">
                                <div class="bg-purple-500 h-full rounded-full" style="width: ${width}%"></div>
                            </div>
                        </div>`;
                    }).join('')}
                </div>
            </div>
        </div>
        `;
    },

    renderStoryCard(s) {
        const isLate = s.calc.finalEnd instanceof Date && new Date() > s.calc.finalEnd;
        let statusColor = isLate ? "bg-red-100 text-red-700" : "bg-indigo-100 text-indigo-700";
        
        return `
        <div onclick="ui.openStoryModal('${s.id}')" class="group p-3 mb-2 bg-slate-50 border border-slate-100 rounded-xl hover:border-indigo-300 hover:bg-white transition-all cursor-pointer">
            <div class="flex justify-between items-start mb-2">
                <span class="text-[9px] font-bold px-2 py-0.5 rounded-full ${statusColor} uppercase">
                    ${s.state}
                </span>
                <span class="text-[9px] text-slate-400 font-mono">#${s.id}</span>
            </div>
            <h5 class="text-xs font-bold text-slate-800 group-hover:text-indigo-600 transition-colors line-clamp-1">${s.title}</h5>
            <div class="flex items-center gap-4 mt-2">
                <div class="flex items-center gap-1">
                    <span class="text-[9px] text-slate-400 font-bold uppercase tracking-tighter">Dev:</span>
                    <span class="text-[10px] font-medium text-slate-600">${s.assignedTo}</span>
                </div>
                <div class="flex items-center gap-1">
                    <span class="text-[9px] text-slate-400 font-bold uppercase tracking-tighter">Testing:</span>
                    <span class="text-[10px] font-medium text-slate-600">${s.tester}</span>
                </div>
            </div>
        </div>`;
    },

    exportDailyActivityToExcel() {
        const todayStr = new Date().toISOString().split('T')[0];
        const activities = [];

        const nonBacklog = currentData.filter(s => !isBacklogStory(s));

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

            if (hasActivityToday) {
                activities.push({
                    id: story.id,
                    title: story.title,
                    branch: story.branch || "N/A",
                    area: story.area || "General",
                    customer: story.customer || "General",
                    state: story.state,
                    assignedTo: story.assignedTo
                });
            }
        });

        if (activities.length === 0) return alert("لا توجد أنشطة مسجلة بتاريخ اليوم لتصديرها");

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
            Object.values(grouped[branch]).forEach(area => {
                Object.values(area).forEach(cust => branchCount += cust.length);
            });
            
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

        // Exclude backlog from inactive
        const nonBacklog = currentData.filter(s => !isBacklogStory(s));

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
                        <h3 class="text-xl font-extrabold text-slate-800">${area}</h3>
                        <span class="px-3 py-1 bg-indigo-50 text-indigo-600 rounded-full text-xs font-bold">${groupedByArea[area].length} Stories</span>
                        <div class="flex-grow h-px bg-slate-200"></div>
                    </div>
                </div>
            `;

            groupedByArea[area].forEach(s => {
                const lastAction = s.changedDate ? new Date(s.changedDate) : now;
                const diffDays = Math.floor(Math.abs(now - lastAction) / (1000 * 60 * 60 * 24));

                let dayColorClass = "text-green-500 border-green-200 bg-green-50";
                if (diffDays > 1 && diffDays <= 3) dayColorClass = "text-amber-500 border-amber-200 bg-amber-50";
                else if (diffDays > 3) dayColorClass = "text-red-500 border-red-200 bg-red-50";

                html += `
                    <div class="col-span-full lg:col-span-1 bg-white p-5 rounded-2xl border border-slate-100 shadow-sm hover:shadow-md transition-all cursor-pointer flex items-center gap-5" onclick="ui.openStoryModal('${s.id}')">
                        
                        <div class="flex flex-col items-center justify-center min-w-[80px] h-[80px] rounded-2xl border-2 ${dayColorClass}">
                            <span class="text-3xl font-black leading-none">${diffDays}</span>
                            <span class="text-[9px] font-bold uppercase mt-1">Days</span>
                        </div>

                        <div class="flex-grow min-w-0">
                            <div class="flex items-center gap-2 mb-1">
                                <span class="text-[10px] font-bold text-slate-400">#${s.id}</span>
                                <span class="px-2 py-0.5 bg-slate-100 text-[9px] font-bold rounded uppercase text-slate-500">${s.state}</span>
                                <span class="ml-auto font-bold text-indigo-600 text-[10px]">P${s.priority}</span>
                            </div>
                            
                            <h3 class="font-bold text-slate-800 text-sm mb-1 truncate" title="${s.title}">${s.title}</h3>
                            
                            <div class="flex flex-wrap gap-1 mb-2">
                                ${(s.tags || []).map(t => `<span class="px-2 py-0.5 bg-red-50 text-red-700 border border-red-200 rounded text-[9px] font-semibold">${t}</span>`).join('')}
                            </div>
                            
                            <div class="flex flex-wrap gap-y-1 gap-x-4">
                                <div class="flex items-center gap-1 text-[11px] text-slate-500">
                                    <span class="font-semibold text-slate-700">Dev:</span> ${s.assignedTo || '---'}
                                </div>
                                <div class="flex items-center gap-1 text-[11px] text-slate-500">
                                    <span class="font-semibold text-slate-700">QA:</span> ${s.tester || '---'}
                                </div>
                                <div class="flex items-center gap-1 text-[11px] text-red-400">
                                    <span class="font-semibold">Last:</span> ${s.changedDate ? new Date(s.changedDate).toLocaleDateString('en-GB') : 'N/A'}
                                </div>
                            </div>
                        </div>
                    </div>
                `;
            });
        }

        container.innerHTML = `<div class="grid grid-cols-1 xl:grid-cols-2 gap-4">${html}</div>`;
    },

    renderSettings() {
        const nonBacklog = currentData.filter(s => !isBacklogStory(s));
        const staff = [...new Set(nonBacklog.map(s => s.assignedTo).concat(nonBacklog.map(s => s.tester)))];
        const staffSelect = document.getElementById('staff-select');
        if(staffSelect) staffSelect.innerHTML = staff.map(s => `<option value="${s}">${s}</option>`).join('');

        document.getElementById('vacations-list').innerHTML = db.vacations.map((v, i) => `
            <div class="flex justify-between bg-gray-50 p-1 px-2 rounded mb-1">
                <span>${v.name} - ${v.date}</span>
                <button onclick="settings.removeVacation(${i})" class="text-red-500">×</button>
            </div>
        `).join('');

        document.getElementById('holidays-list').innerHTML = db.holidays.map((h, i) => `
            <span class="bg-gray-200 px-2 py-1 rounded text-xs inline-flex items-center gap-1 m-1">
                ${h} <button onclick="settings.removeHoliday(${i})" class="text-red-500">×</button>
            </span>
        `).join('');

        const usersList = document.getElementById('users-list');
        if(usersList) {
            usersList.innerHTML = db.users.map((u, i) => `
                <div class="flex justify-between items-center bg-gray-50 p-2 rounded border">
                    <div>
                        <span class="font-bold text-slate-700">${u.username}</span>
                        <span class="text-[10px] ml-2 px-2 py-0.5 rounded-full ${u.role === 'admin' ? 'bg-red-100 text-red-600' : 'bg-blue-100 text-blue-600'}">${u.role}</span>
                    </div>
                    <button onclick="settings.removeUser(${i})" class="text-red-500 hover:text-red-700 font-bold text-xl">&times;</button>
                </div>
            `).join('');
        }

        // Render tags
        tagManager.renderTagsSettings();
    },

    renderAuditorChecklist() {
        const tbody = document.getElementById('auditor-table-body');
        if (!tbody) return;

        const areaFilter = document.getElementById('auditor-area-filter')?.value || 'all';
        const stateFilter = document.getElementById('auditor-state-filter')?.value || 'all';

        const areaSelect = document.getElementById('auditor-area-filter');
        // Exclude backlog from auditor
        const nonBacklog = currentData.filter(s => !isBacklogStory(s));
        
        if (areaSelect && areaSelect.options.length <= 1) {
            const areas = [...new Set(nonBacklog.map(s => s.area || "General"))];
            areaSelect.innerHTML = '<option value="all">All Areas</option>' + areas.map(a => `<option value="${a}">${a}</option>`).join('');
        }

        let filtered = nonBacklog;
        if (areaFilter !== 'all') {
            filtered = filtered.filter(s => (s.area || "General") === areaFilter);
        }
        if (stateFilter !== 'all') {
            filtered = filtered.filter(s => s.state === stateFilter);
        }

        if (filtered.length === 0) {
            tbody.innerHTML = `<tr><td colspan="10" class="text-center py-8 text-gray-400">No stories match the selected filters.</td></tr>`;
            return;
        }

        const rowsHtml = filtered.map(story => {
            const criteria = this.evaluateStoryCompliance(story);
            const compliancePercent = Math.round((criteria.passedCount / criteria.totalCount) * 100);
            
            let barColor = 'bg-red-500';
            if (compliancePercent >= 80) barColor = 'bg-green-500';
            else if (compliancePercent >= 50) barColor = 'bg-yellow-500';
            
            return `
                <tr class="border-b hover:bg-gray-50 transition">
                    <td class="px-4 py-3 font-mono text-xs">#${story.id}</td>
                    <td class="px-4 py-3 font-medium text-slate-700 max-w-xs truncate" title="${story.title}">${story.title}</td>
                    <td class="px-4 py-3"><span class="px-2 py-1 rounded-full text-xs font-bold bg-gray-100 text-gray-700">${story.state}</span></td>
                    <td class="px-4 py-3 text-center">
                        <div class="flex flex-col items-center gap-1">
                            <span class="text-xs font-bold">${compliancePercent}%</span>
                            <div class="w-full bg-gray-200 rounded-full h-2 max-w-[80px]">
                                <div class="${barColor} h-2 rounded-full" style="width: ${compliancePercent}%"></div>
                            </div>
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

        const testTasksList = story.tasks.filter(t => 
            t['Activity'] === 'Testing' || 
            (t['Title'] && (t['Title'].toLowerCase().includes('prep') || t['Title'].toLowerCase().includes('preparation')))
        );
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
        if (reviews.length > 0) {
            reviewsValid = reviews.every(r => ['Closed', 'Resolved'].includes(r.state));
        }
        if (reviewsValid) passedCount++;

        return {
            passedCount,
            totalCount,
            priority: priorityValid,
            iterationPath: iterationPathValid,
            devTasks: devTasksValid,
            testTasks: testTasksValid,
            testCasesPass: testCasesValid,
            bugsClosed: bugsValid,
            reviewsClosed: reviewsValid
        };
    }
};

/**
 * Settings Management
 */
const settings = {
    addUser() {
        const username = document.getElementById('new-user-name').value;
        const password = document.getElementById('new-user-pass').value;
        const role = document.getElementById('new-user-role').value;

        if(!username || !password) return alert("Please fill all fields");
        
        if(db.users.some(u => u.username === username)) return alert("User already exists");

        db.users.push({ username, password, role });
        dataProcessor.saveToGitHub().then(() => {
            alert("User added successfully");
            ui.renderSettings();
        });
    },

    removeUser(index) {
        if(db.users[index].username === currentUser.username) return alert("Cannot delete yourself!");
        db.users.splice(index, 1);
        dataProcessor.saveToGitHub();
        ui.renderSettings();
    },
    
    addVacation() {
        const name = document.getElementById('staff-select').value;
        const date = document.getElementById('vacation-date').value;
        if(!date) return;
        db.vacations.push({name, date});
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
        if(!date) return;
        db.holidays.push(date);
        dataProcessor.saveToGitHub();
        ui.renderSettings();
    },
    removeHoliday(i) {
        db.holidays.splice(i, 1);
        dataProcessor.saveToGitHub();
        ui.renderSettings();
    }
};

const tagManager = {
    addTag() {
        const input = document.getElementById('new-tag-input');
        const tagName = input.value.trim();
        if(!tagName || db.customTags.includes(tagName)) return;
        
        db.customTags.push(tagName);
        input.value = '';
        dataProcessor.saveToGitHub();
        this.renderTagsSettings();
        ui.renderAll();
    },

    removeTag(tagName) {
        db.customTags = db.customTags.filter(t => t !== tagName);
        db.currentStories.forEach(s => { if(s.customTag === tagName) delete s.customTag; });
        dataProcessor.saveToGitHub();
        this.renderTagsSettings();
        ui.renderAll();
    },

    assignTagToStory(storyId, tagName) {
        const story = db.currentStories.find(s => s.ID == storyId);
        if(story) {
            story.customTag = tagName;
            dataProcessor.saveToGitHub();
        }
    },

    renderTagsSettings() {
        const container = document.getElementById('tags-list');
        if(!container) return;
        container.innerHTML = db.customTags.map(tag => `
            <span class="bg-purple-100 text-purple-800 px-3 py-1 rounded-full text-sm font-medium flex items-center gap-2">
                ${tag}
                <button onclick="tagManager.removeTag('${tag}')" class="text-red-500 hover:text-red-700 font-bold">×</button>
            </span>
        `).join('');
    },

    toggleTagInStory(storyId, tagName) {
        const story = db.currentStories.find(s => (s.id || s.ID || s.idReadable) == storyId);
        
        if (story) {
            if (!story.customTags) {
                story.customTags = [];
            }
            
            const index = story.customTags.indexOf(tagName);
            if (index > -1) {
                story.customTags.splice(index, 1);
            } else {
                story.customTags.push(tagName);
            }
            
            dataProcessor.saveToGitHub();
            ui.renderActiveCards(); 
        } else {
            console.error("Story not found in database for ID:", storyId);
        }
    }
};

const commentManager = {
    updateComment(storyId, text) {
        const story = db.currentStories.find(s => (s.id || s.ID) == storyId);
        if (story) {
            if (!story.standupComments) story.standupComments = [];
            
            story.standupComments.push({
                text: text,
                date: new Date().toLocaleString('en-GB'),
                timestamp: Date.now()
            });

            dataProcessor.saveToGitHub();
            ui.renderActiveCards(); 
        }
    }
};

/**
 * Azure DevOps Integration
 */
const azureDevOps = {
    async sync() {
        const pat = sessionStorage.getItem('az_pat');
        const settings = JSON.parse(localStorage.getItem('az_settings')) || {
            org: "NTDotNet",
            project: "LDM",
            queryId: "8a732680-07a6-4dff-bdbd-7800644f61b9",
            backlogQueryId: "8e60a3dd-d754-44d2-95ec-993c4e0d135b"
        };

        if (!pat) return alert("Azure PAT is missing. Please login again.");

        const syncBtn = document.querySelector("button[onclick='azureDevOps.sync()']");
        syncBtn.innerText = "⏳ Syncing...";
        syncBtn.disabled = true;

        try {
            const authHeader = 'Basic ' + btoa(':' + pat);

            const fetchIds = async (queryId) => {
                if (!queryId) return [];
                const url = `https://dev.azure.com/${settings.org}/${settings.project}/_apis/wit/wiql/${queryId}?api-version=6.0`;
                const res = await fetch(url, { headers: { 'Authorization': authHeader } });
                const data = await res.json();
                if (data.workItemRelations) {
                    return data.workItemRelations.map(r => r.target ? r.target.id : null).filter(id => id);
                } else if (data.workItems) {
                    return data.workItems.map(wi => wi.id).filter(id => id);
                }
                return [];
            };

            const mainIds = await fetchIds(settings.queryId);
            const backlogIds = await fetchIds(settings.backlogQueryId);

            console.log(`Main IDs: ${mainIds.length}, Backlog IDs: ${backlogIds.length}`);

            const allIds = [...new Set([...mainIds, ...backlogIds])];
            if (allIds.length === 0) throw new Error("No items found in the specified queries.");

            const chunkSize = 200;
            let allDetails = [];
            for (let i = 0; i < allIds.length; i += chunkSize) {
                const chunk = allIds.slice(i, i + chunkSize);
                const batchUrl = `https://dev.azure.com/${settings.org}/_apis/wit/workitemsbatch?api-version=6.0`;
                const batchRes = await fetch(batchUrl, {
                    method: 'POST',
                    headers: { 'Authorization': authHeader, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ ids: chunk, fields: this.getRequiredFields() })
                });
                const batchData = await batchRes.json();
                allDetails = allDetails.concat(batchData.value);
            }

            const mainDetails = allDetails.filter(d => mainIds.includes(d.id));
            const backlogDetails = allDetails.filter(d => backlogIds.includes(d.id));

            // Process main query
            const mainRows = this.buildRowsFromDetails(mainDetails);
            dataProcessor.processRows(mainRows);

            // Process backlog query
            const backlogRows = this.buildBacklogRows(backlogDetails);
            dataProcessor.processBacklogRows(backlogRows);

        } catch (error) {
            console.error("Azure Sync Error:", error);
            alert("فشل الاتصال بـ Azure: " + error.message);
        } finally {
            syncBtn.innerHTML = "🔄 <span class='hidden md:inline'>Sync from Azure</span>";
            syncBtn.disabled = false;
        }
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

    buildRowsFromDetails(details) {
        const rows = [];
        details.forEach(d => {
            const fields = d.fields || {};
            rows.push({
                'ID': d.id,
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

    buildBacklogRows(details) {
        const rows = [];
        details.forEach(d => {
            const fields = d.fields || {};
            const state = fields["System.State"] || "";
            // Only New or Approved
            if (!["New", "Approved"].includes(state)) return;
            rows.push({
                'ID': d.id,
                'Work Item Type': fields["System.WorkItemType"] || "User Story",
                'Title': fields["System.Title"] || "Untitled",
                'Assigned To': fields["System.AssignedTo"]?.displayName || "Unassigned",
                'Business Area': fields["MyCompany.MyProcess.BusinessArea"] || "General",
                'State': state,
                'Business Priority': fields["MyCompany.MyProcess.BusinessPriority"] || 999,
                'Release Expected Date': fields["MyCompany.MyProcess.Release"],
                'Tags': fields["System.Tags"] || "",
                'Iteration Path': fields["System.IterationPath"] || "",
                'Changed Date': fields["System.ChangedDate"]
            });
        });
        console.log(`Backlog rows built: ${rows.length}`);
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
        alert("تم حفظ إعدادات Azure بنجاح");
    }
};

/**
 * Initialize
 */
window.onload = () => {
    const saved = localStorage.getItem('saved_creds');
    if(saved) {
        const creds = JSON.parse(saved);
        document.getElementById('username').value = creds.u;
        document.getElementById('password').value = creds.p;
        document.getElementById('gh-token').value = creds.t;
        document.getElementById('az-pat').value = creds.azPat;
        auth.handleLogin();
    }
};
