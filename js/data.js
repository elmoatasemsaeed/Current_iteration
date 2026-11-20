/**
 * Auth, Archiver & Data Processor (GitHub Sync + CSV + Timeline Calculation)
 */
const archiver = {
    async runArchive() {
        const thresholdMs = Date.now() - (17 * 24 * 60 * 60 * 1000);
        const logsToArchive = db.deliveryLogs.filter(log => log.timestamp < thresholdMs);
        if (logsToArchive.length === 0) return;

        const logsToKeep = db.deliveryLogs.filter(log => log.timestamp >= thresholdMs);
        const token = sessionStorage.getItem('gh_token') || localStorage.getItem('gh_token');
        if (!token) return;

        try {
            let archiveData = [];
            let existingSha = "";
            const response = await fetch(`https://api.github.com/repos/${CONFIG.REPO_NAME}/contents/${CONFIG.ARCHIVE_PATH}?t=${Date.now()}`, {
                cache: 'no-store',
                headers: { 'Authorization': `token ${token}` }
            });
            if (response.ok) {
                const file = await response.json();
                existingSha = file.sha || "";
                if (file.content) {
                    archiveData = JSON.parse(decodeURIComponent(escape(atob(file.content.replace(/\s/g, '')))));
                }
            } else if (response.status !== 404) {
                throw new Error(`Failed to fetch archive (${response.status})`);
            }

            archiveData = [...archiveData, ...logsToArchive];
            await this.saveFileToGitHub(CONFIG.ARCHIVE_PATH, archiveData, token, existingSha);
            db.deliveryLogs = logsToKeep;
            indexes.rebuildDeliveryLogs();
            await dataProcessor.saveToGitHub();
            console.log(`${logsToArchive.length} records moved to archive.`);
        } catch (error) {
            console.error("Archive process failed:", error);
        }
    },

    async saveFileToGitHub(path, data, token, knownSha = "") {
        const authToken = token || sessionStorage.getItem('gh_token') || localStorage.getItem('gh_token');
        const url = `https://api.github.com/repos/${CONFIG.REPO_NAME}/contents/${path}`;
        let sha = knownSha;
        if (!sha) {
            const res = await fetch(`${url}?t=${Date.now()}`, {
                cache: 'no-store',
                headers: { 'Authorization': `token ${authToken}` }
            });
            if (res.ok) {
                const file = await res.json();
                sha = file.sha || "";
            }
        }
        const jsonString = JSON.stringify(data, null, 2);
        const content = btoa(unescape(encodeURIComponent(jsonString)));
        const putRes = await fetch(url, {
            method: 'PUT',
            headers: { 'Authorization': `token ${authToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                message: `Archive delivery logs [${new Date().toLocaleDateString()}]`,
                content: content,
                ...(sha ? { sha } : {})
            })
        });
        if (!putRes.ok) {
            throw new Error(`Archive save failed: ${putRes.status}`);
        }
    }
};

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
            const cacheBust = Date.now();
            const rawUrl = `https://api.github.com/repos/${CONFIG.REPO_NAME}/contents/${CONFIG.FILE_PATH}?t=${cacheBust}`;
            const response = await fetch(rawUrl, {
                cache: 'no-store',
                headers: {
                    'Authorization': `token ${t}`,
                    'Accept': 'application/vnd.github.v3.raw'
                }
            });

            if (response.ok) {
                const remoteDb = await response.json();
                if (!remoteDb || typeof remoteDb !== 'object' || !Array.isArray(remoteDb.users)) {
                    throw new Error('استجابة غير صالحة من GitHub: لم يتم استلام بيانات db.json بشكل صحيح.');
                }
                const userMatch = remoteDb.users.find(user => user.username === u && user.password === p);
                if (userMatch) {
                    db = ensureDbDefaults(remoteDb);

                    const convertDates = (story) => {
                        if (story.expectedRelease) story.expectedRelease = new Date(story.expectedRelease);
                        if (story.changedDate) story.changedDate = new Date(story.changedDate);
                        return story;
                    };
                    if (db.currentStories && db.currentStories.length > 0) {
                        db.currentStories = db.currentStories.map(convertDates);
                    }
                    if (db.backlogStories && db.backlogStories.length > 0) {
                        db.backlogStories = db.backlogStories.map(convertDates);
                    }

                    migrateStandupComments();
                    pruneStandupComments();
                    indexes.rebuildAll();

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
        if (db.currentStories && db.currentStories.length > 0) {
            dataProcessor.calculateTimelines(db.currentStories);
        } else {
            ui.renderAll();
        }
        ui.switchTab('dashboard');
    },

    logout() {
        localStorage.removeItem('saved_creds');
        location.reload();
    }
};

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

        if (!Array.isArray(db.users) || db.users.length === 0) {
            throw new Error('رفض الحفظ: قائمة المستخدمين فاضية (حماية من مسح بيانات المستخدمين).');
        }

        const hasContent =
            (db.currentStories?.length || 0) +
            (db.backlogStories?.length || 0) +
            (db.users?.length || 0) > 0;

        if (!hasContent) {
            throw new Error('رفض الحفظ: قاعدة البيانات فاضية تماماً (حماية من المسح).');
        }

        const timestamp = Date.now();
        const metaRes = await fetch(`https://api.github.com/repos/${CONFIG.REPO_NAME}/contents/${CONFIG.FILE_PATH}?t=${timestamp}`, {
            headers: { 'Authorization': `token ${token}` }
        });

        if (!metaRes.ok) {
            if (metaRes.status === 404) {
                throw new Error('الملف غير موجود على GitHub. لا يمكن الحفظ بدون SHA.');
            }
            throw new Error(`Failed to get metadata: ${metaRes.status} ${metaRes.statusText}`);
        }

        const metaData = await metaRes.json();
        const latestSha = metaData.sha;

        cleanProjectArtifacts(db);
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
            throw new Error(error.message || `Save failed: ${response.status}`);
        }

        const result = await response.json();
        db.sha = result.content.sha;
        console.log('Saved successfully with new SHA');
        return result;
    },

    async sync() {
        const token = sessionStorage.getItem('gh_token');
        try {
            const rawUrl = `https://api.github.com/repos/${CONFIG.REPO_NAME}/contents/${CONFIG.FILE_PATH}?t=${Date.now()}`;
            const response = await fetch(rawUrl, {
                cache: 'no-store',
                headers: {
                    'Authorization': `token ${token}`,
                    'Accept': 'application/vnd.github.v3.raw'
                }
            });

            if (response.ok) {
                const remoteDb = await response.json();
                if (!remoteDb || typeof remoteDb !== 'object' || !Array.isArray(remoteDb.users)) {
                    throw new Error('استجابة غير صالحة من GitHub: لم يتم استلام بيانات db.json بشكل صحيح.');
                }
                db = ensureDbDefaults(remoteDb);

                const convertDates = (story) => {
                    if (story.expectedRelease) story.expectedRelease = new Date(story.expectedRelease);
                    if (story.changedDate) story.changedDate = new Date(story.changedDate);
                    return story;
                };

                indexes.rebuildCalendar();
                indexes.rebuildDeliveryLogs();

                if (db.currentStories && db.currentStories.length > 0) {
                    db.currentStories = db.currentStories.map(convertDates);
                    this.calculateTimelines(db.currentStories);
                }
                if (db.backlogStories && db.backlogStories.length > 0) {
                    db.backlogStories = db.backlogStories.map(convertDates);
                }

                migrateStandupComments();
                pruneStandupComments();
                indexes.rebuildAll();

                ui.renderAll();
            } else if (response.status === 404) {
                console.log("File not found, creating new DB...");
                this.saveToGitHub();
            } else {
                throw new Error(`GitHub API returned ${response.status} ${response.statusText}`);
            }
        } catch (e) {
            console.error("Sync Error:", e);
            ui.showToast("خطأ في المزامنة مع GitHub: " + e.message, "error");
        }
    },

    async handleCSV(event) {
        const file = event.target.files[0];
        if (!file) return;
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
        if (!Array.isArray(rows) || rows.length === 0) {
            console.warn('⚠️ processRows: لم يتم استلام أي صفوف. تم إلغاء العملية لحماية البيانات.');
            ui.showToast('⚠️ لم يتم استلام بيانات من Azure. تم إلغاء التحديث لحماية البيانات.', 'error');
            return;
        }

        const existingMap = new Map((db.currentStories || []).map(s => [String(s.id), s]));
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
                    pullRequests: []
                };
                const existingStory = existingMap.get(String(currentStory.id));
                if (existingStory) {
                    if (existingStory.customTags) currentStory.customTags = existingStory.customTags;
                    if (existingStory.pullRequests) currentStory.pullRequests = existingStory.pullRequests;
                }
                newStories.push(currentStory);
            } else if (itemType === 'Task' && currentStory) {
                currentStory.tasks.push(row);
            } else if (itemType === 'Bug' && currentStory) {
                currentStory.bugs.push(row);
            } else if (itemType === 'Test Case' && currentStory) {
                currentStory.testCases.push({
                    id: row['ID'],
                    state: row['State']
                });
            } else if (itemType === 'Review' && currentStory) {
                currentStory.reviews.push({
                    id: row['ID'],
                    title: row['Title'],
                    state: row['State'],
                    assignedTo: row['Assigned To'] || "Unassigned"
                });
            }
        });

        if (newStories.length === 0) {
            console.warn('⚠️ processRows: لم يتم بناء أي قصة من الصفوف المستلمة. تم إلغاء التحديث.');
            ui.showToast('⚠️ لم يتم بناء أي قصة. تم إلغاء التحديث لحماية البيانات.', 'error');
            return;
        }

        this.calculateTimelines(newStories);
        db.currentStories = newStories;
        indexes.rebuildStories();

        pruneStandupComments();
        await this.saveToGitHub();
    },

    async processBacklogRows(rows) {
        if (!Array.isArray(rows) || rows.length === 0) {
            console.warn('⚠️ processBacklogRows: لم يتم استلام أي صفوف. تم تخطي تحديث الـ Backlog.');
            return;
        }

        console.log(`Processing ${rows.length} backlog rows`);
        const existingBacklogMap = new Map((db.backlogStories || []).map(s => [String(s.id), s]));

        const backlogStories = [];
        for (const row of rows) {
            const state = row['State'] || "";
            if (!["New", "Approved"].includes(state)) continue;
            const story = {
                id: row['ID'],
                title: row['Title'] || "Untitled",
                type: 'User Story',
                state: state,
                assignedTo: row['Assigned To'] || "Unassigned",
                tester: "Unassigned",
                area: row['Business Area'] || "General",
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
                pullRequests: []
            };
            const existing = existingBacklogMap.get(String(story.id));
            if (existing) {
                if (existing.customTags) story.customTags = existing.customTags;
                if (existing.pullRequests) story.pullRequests = existing.pullRequests;
            }
            backlogStories.push(story);
        }

        if (backlogStories.length === 0) {
            console.warn('⚠️ processBacklogRows: لم يتم بناء أي قصة بعد الفلترة. تم إلغاء تحديث الـ Backlog.');
            return;
        }

        db.backlogStories = backlogStories;
        indexes.rebuildStories();

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
            const activatedDates = devTasks.map(t => t['Activated Date']).filter(Boolean).sort();
            if (activatedDates.length > 0) devStart = new Date(activatedDates[0]);

            if (!devStart) {
                story.calc.error = "بانتظار تفعيل التاسكات (No Activated Tasks)";
                story.calc.devEnd = "TBD";
                story.calc.testEnd = "---";
                story.calc.finalEnd = "---";
                return;
            }

            const devActualStart = new Date(Math.max(devStart, staffAvailability[story.assignedTo] || devStart));
            story.calc.devEnd = dateEngine.addWorkingHours(devActualStart, devHours, story.assignedTo);
            staffAvailability[story.assignedTo] = new Date(story.calc.devEnd);

            const testTasks = story.tasks.filter(t => t['Activity'] === 'Testing');
            if (testTasks.length === 0) {
                story.calc.testEnd = "Waiting for Data";
                story.calc.finalEnd = "Waiting for Data";
            } else {
                const prepSet = new Set();
                const prepTasks = [];
                const actualTestTasks = [];
                testTasks.forEach(t => {
                    if ((t['Title'] && t['Title'].toLowerCase().includes('prep')) || t['Activity'] === 'Preparation') {
                        prepSet.add(t);
                        prepTasks.push(t);
                    } else {
                        actualTestTasks.push(t);
                    }
                });

                const prepHours = prepTasks.reduce((acc, t) => acc + (t['State'] === 'To Be Reviewed' ? 0 : parseFloat(t['Original Estimation'] || 0)), 0);
                const actualTestHours = actualTestTasks.reduce((acc, t) => acc + (t['State'] === 'To Be Reviewed' ? 0 : parseFloat(t['Original Estimation'] || 0)), 0);
                const prepActivatedDates = prepTasks.map(t => t['Activated Date']).filter(Boolean).sort();
                const prepStart = prepActivatedDates.length > 0 ? new Date(prepActivatedDates[0]) : null;

                const readyForTestDate = new Date(story.calc.devEnd);
                readyForTestDate.setDate(readyForTestDate.getDate() + 1);
                readyForTestDate.setHours(9, 0, 0, 0);

                const testActualStart = new Date(Math.max(readyForTestDate, staffAvailability[story.tester] || readyForTestDate));
                if (prepStart && prepStart < story.calc.devEnd) {
                    story.calc.testEnd = dateEngine.addWorkingHours(testActualStart, actualTestHours, story.tester);
                } else {
                    story.calc.testEnd = dateEngine.addWorkingHours(testActualStart, prepHours + actualTestHours, story.tester);
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
        indexes.rebuildStories();
        ui.renderAll();
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
