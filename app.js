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
    WEEKEND: [5, 6] // الجمعة والسبت
};

let db = {
    users: [],
    vacations: [], 
    holidays: [],  
    deliveryLogs: [],
    currentStories: [],
    customTags: [] // Added for custom tags
};

let currentData = []; 
let currentUser = null;

const archiver = {
    async runArchive() {
        const TenDaysAgo = Date.now() - (31 * 24 * 60 * 60 * 1000);
        
        // 1. تصفية البيانات (القديمة للأرشفة، والجديدة للبقاء)
        const logsToArchive = db.deliveryLogs.filter(log => log.timestamp < TenDaysAgo);
        const logsToKeep = db.deliveryLogs.filter(log => log.timestamp >= TenDaysAgo);

        if (logsToArchive.length === 0) return; // لا يوجد شيء لأرشفته

        try {
            // 2. جلب ملف الأرشيف الحالي من GitHub (أو إنشاء مصفوفة فارغة إذا لم يوجد)
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

            // 3. دمج البيانات القديمة مع الأرشيف
            archiveData = [...archiveData, ...logsToArchive];

            // 4. حفظ الأرشيف المحدث على GitHub
            await this.saveFileToGitHub(CONFIG.ARCHIVE_PATH, archiveData);

            // 5. تحديث ملف db الأساسي (حذف البيانات المؤرشفة منه)
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
        
        // جلب SHA للملف إذا كان موجوداً لتحديثه
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

        // إظهار رسالة تحميل بسيطة على الزر
        const loginBtn = document.querySelector("button[onclick='auth.handleLogin()']");
        const originalText = loginBtn.innerText;
        loginBtn.innerText = "جاري التحقق...";
        loginBtn.disabled = true;

        try {
            // محاولة جلب الملف من GitHub للتحقق من بيانات المستخدمين
           const response = await fetch(`https://api.github.com/repos/${CONFIG.REPO_NAME}/contents/${CONFIG.FILE_PATH}`, {
    headers: { 
        'Authorization': `token ${t}`,
        'Accept': 'application/vnd.github.v3.raw' // هذا السطر يحل مشكلة الـ 1MB
    }
});

if (response.ok) {
    // بما أننا طلبنا المحتوى الخام، الاستجابة ستكون نص الـ JSON مباشرة
    const remoteDb = await response.json(); 
    
    // نحتاج للـ SHA للتحديث لاحقاً، لذا سنقوم بطلبه في طلب منفصل سريع (Metadata only)
    const metaRes = await fetch(`https://api.github.com/repos/${CONFIG.REPO_NAME}/contents/${CONFIG.FILE_PATH}`, {
        headers: { 'Authorization': `token ${t}` }
    });
    const metaData = await metaRes.json();

    const userMatch = remoteDb.users.find(user => user.username === u && user.password === p);
    
    if (userMatch) {
        db = remoteDb;
        db.sha = metaData.sha; // حفظ الـ SHA من بيانات الميتا
        if (!db.customTags) db.customTags = [];
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
        
        // التحقق من صلاحيات المشاهد (Viewer)
        if (currentUser.role === 'viewer') {
            // 1. إخفاء زرار رفع الـ CSV تماماً (الزرار الأخضر)
            const uploadBtn = document.querySelector("button[onclick*='csv-input']");
            if (uploadBtn) uploadBtn.style.display = 'none';

            // 2. إخفاء تبويب الإعدادات من القائمة العلوية
            const settingsNav = document.querySelector("button[onclick*='settings']");
            if (settingsNav) settingsNav.style.display = 'none';

            // 3. إخفاء أزرار المزامنة إذا أردت منعهم من الضغط عليها
            // document.querySelector("button[onclick*='dataProcessor.sync()']").style.display = 'none';
        }
        
        ui.switchTab('active'); 
        dataProcessor.sync(); 
    },

    logout() {
        localStorage.removeItem('saved_creds');
        location.reload();
    }
};

/**
 * Data Processing Engine
 */
const dataProcessor = {
    async sync() {
    const token = sessionStorage.getItem('gh_token');
    try {
        // 1. طلب المحتوى الخام (Raw) لتجاوز حد الـ 1MB
        const response = await fetch(`https://api.github.com/repos/${CONFIG.REPO_NAME}/contents/${CONFIG.FILE_PATH}`, {
            headers: { 
                'Authorization': `token ${token}`,
                'Accept': 'application/vnd.github.v3.raw' // ضروري جداً لقراءة الملفات الكبيرة
            }
        });

        if (response.ok) {
            // البيانات تعود كنص JSON مباشر وليس Base64
            db = await response.json(); 
            if (!db.customTags) db.customTags = [];
            
            // 2. طلب الـ SHA بشكل منفصل (Metadata) لاستخدامه عند الحفظ لاحقاً
            const metaRes = await fetch(`https://api.github.com/repos/${CONFIG.REPO_NAME}/contents/${CONFIG.FILE_PATH}`, {
                headers: { 'Authorization': `token ${token}` }
            });
            const metaData = await metaRes.json();
            db.sha = metaData.sha; 
            
            // 3. معالجة البيانات وتحميلها في الـ UI
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

async saveToGitHub() {
    const token = sessionStorage.getItem('gh_token');
    if(!token) return;

    try {
        // إضافة طابع زمني للرابط لتجنب الكاش بدون استخدام Cache-Control header
        const timestamp = new Date().getTime();
        const metaRes = await fetch(`https://api.github.com/repos/${CONFIG.REPO_NAME}/contents/${CONFIG.FILE_PATH}?t=${timestamp}`, {
            headers: { 
                'Authorization': `token ${token}`
            }
        });
        
        const metaData = await metaRes.json();
        const latestSha = metaData.sha;

        if (!latestSha) {
            throw new Error("Could not retrieve file SHA from GitHub");
        }

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

        if (response.ok) {
            const result = await response.json();
            db.sha = result.content.sha;
            console.log("Saved successfully with new SHA");
        } else {
            const errorDetails = await response.json();
            throw new Error(errorDetails.message);
        }
    } catch (e) {
        console.error("Save Error:", e);
        alert("فشل الحفظ: " + e.message);
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
    const newStories = []; // سنقوم بتجميع القصص الجديدة هنا أولاً
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
                reviews: [],        // NEW: for Review work items
                calc: {},
                customTags: [], 
                standupComments: [],
                iterationPath: row['Iteration Path'] || "",
                devActualTime: parseFloat(row['TimeSheet_DevActualTime']) || 0,
                testActualTime: parseFloat(row['TimeSheet_TestingActualTime']) || 0
            };

            // --- التعديل الجوهري هنا ---
            // ابحث عن القصة القديمة في قاعدة البيانات الحالية باستخدام الـ ID
          const existingStory = db.currentStories.find(s => s.id == currentStory.id);
if (existingStory) {
    if (existingStory.customTags) {
        currentStory.customTags = existingStory.customTags;
    }
    // حفظ التعليقات القديمة عند التحديث
    if (existingStory.standupComments) {
        currentStory.standupComments = existingStory.standupComments;
    }
}
            // ---------------------------

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
            // NEW: جمع عناصر المراجعة
            currentStory.reviews.push({
                id: row['ID'],
                title: row['Title'],
                state: row['State'],
                assignedTo: row['Assigned To'] || "Unassigned"
            });
        }
    });

    this.calculateTimelines(newStories);
    db.currentStories = newStories; // الآن المصفوفة تحتوي على القصص المحدثة مع الحفاظ على التاجات
    this.saveToGitHub().then(() => alert("تم تحديث البيانات بنجاح"));
},
    calculateTimelines(stories) {
        // 1. الترتيب الصارم حسب Business Priority (الأقل أولاً)
        stories.sort((a, b) => (a.priority || 999) - (b.priority || 999));

        // سجلات لتتبع متى يفرغ كل موظف (سواء ديف أو تستر)
        const staffAvailability = {}; 

        stories.forEach(story => {
            // --- أولاً: منطق الـ Development ---
            const devTasks = story.tasks.filter(t => ["Development", "DB Modification"].includes(t['Activity']));
            const devHours = devTasks.reduce((acc, t) => {
                const effort = t['State'] === 'To Be Reviewed' ? 0 : parseFloat(t['Original Estimation'] || 0);
                return acc + effort;
            }, 0);

            // تحديد موعد البداية: من Activated Date لأول تاسك
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

            // التأكد من أن المطور متاح (بناءً على قصص ذات أولوية أعلى)
            let devActualStart = new Date(Math.max(devStart, staffAvailability[story.assignedTo] || devStart));
            story.calc.devEnd = dateEngine.addWorkingHours(devActualStart, devHours, story.assignedTo);
            
            // تحديث إتاحة المطور
            staffAvailability[story.assignedTo] = new Date(story.calc.devEnd);

// --- ثانياً: منطق الـ Testing (مع معالجة عدم وجود تاسكات) ---
const testTasks = story.tasks.filter(t => t['Activity'] === 'Testing');

if (testTasks.length === 0) {
    // إذا لم توجد تاسكات تستر، نضع حالة الانتظار
    story.calc.testEnd = "Waiting for Data";
    story.calc.finalEnd = "Waiting for Data";
} else {
    // فصل مهام التحضير عن مهام التست الفعلية
    const prepTasks = testTasks.filter(t => t['Title'].toLowerCase().includes('prep') || t['Activity'] === 'Preparation');
    const actualTestTasks = testTasks.filter(t => !prepTasks.includes(t));

    const prepHours = prepTasks.reduce((acc, t) => acc + (t['State'] === 'To Be Reviewed' ? 0 : parseFloat(t['Original Estimation'] || 0)), 0);
    const actualTestHours = actualTestTasks.reduce((acc, t) => acc + (t['State'] === 'To Be Reviewed' ? 0 : parseFloat(t['Original Estimation'] || 0)), 0);

    let prepStart = null;
    const prepActivatedDates = prepTasks.map(t => t['Activated Date']).filter(d => d).sort();
    if (prepActivatedDates.length > 0) prepStart = new Date(prepActivatedDates[0]);

    let testActualStart;

    // تحديد بداية التست (دائماً بعد الديف بيوم)
    let readyForTestDate = new Date(story.calc.devEnd);
    readyForTestDate.setDate(readyForTestDate.getDate() + 1);
    readyForTestDate.setHours(9, 0, 0, 0);

    testActualStart = new Date(Math.max(readyForTestDate, staffAvailability[story.tester] || readyForTestDate));

    if (prepStart && prepStart < story.calc.devEnd) {
        // حالة التداخل: نحسب ساعات التست الفعلي فقط
        story.calc.testEnd = dateEngine.addWorkingHours(testActualStart, actualTestHours, story.tester);
    } else {
        // الحالة العادية: نحسب إجمالي الساعات
        const totalTestHours = prepHours + actualTestHours;
        story.calc.testEnd = dateEngine.addWorkingHours(testActualStart, totalTestHours, story.tester);
    }

    // تحديث إتاحة التستر
    staffAvailability[story.tester] = new Date(story.calc.testEnd);
    
    // تحديث موعد التسليم النهائي (بشكل افتراضي هو نهاية التست)
    story.calc.finalEnd = new Date(story.calc.testEnd);
};
            // --- ثالثاً: منطق الـ Bugs (Preemption/Priority Impact) ---
            // إذا وجد بجز، فإنها تستهلك وقت المطور وتؤخر كل مواعيد الانتهاء اللاحقة
            let finalDeliveryDate = new Date(story.calc.testEnd);
            
            if (story.bugs && story.bugs.length > 0) {
                story.bugs.forEach(bug => {
                    const bugEffort = parseFloat(bug['Original Estimation'] || 0);
                    const bugActivatedDate = bug['Activated Date'] ? new Date(bug['Activated Date']) : null;
                    
                    if (bugActivatedDate && bugEffort > 0) {
                        // البج تسحب المطور من عمله الحالي إذا كانت أولوية الستوري عالية
                        // نحسب وقت انتهاء البج بناءً على وقت تفعيلها + جهدها
                        const bugFinish = dateEngine.addWorkingHours(bugActivatedDate, bugEffort, story.assignedTo);
                        
                        // إذا انتهت البج بعد موعد التست، فإنها تدفع موعد التسليم النهائي
                        if (bugFinish > finalDeliveryDate) {
                            finalDeliveryDate = bugFinish;
                        }

                        // هام: البج تؤخر المطور في سجل الإتاحة العام للقصص القادمة
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
        
        // فحص عطلة نهاية الأسبوع (CONFIG.WEEKEND)
        if (CONFIG.WEEKEND.includes(day)) return false;
        
        // فحص الإجازات الرسمية المسجلة في قسم Holidays
        if (db.holidays && db.holidays.includes(dateStr)) return false;
        
        // فحص الإجازات الخاصة بالموظف
        if (db.vacations.some(v => v.name === person && v.date === dateStr)) return false;
        
        return true;
    },
   
    countVacationDaysUntilNow(startDate, personName) {
    if (!startDate) return 0;
    const start = new Date(startDate);
    const today = new Date();
    // ضبط الوقت ليكون بداية اليوم للمقارنة العادلة
    today.setHours(0, 0, 0, 0);
    start.setHours(0, 0, 0, 0);

    if (start > today) return 0;

    let count = 0;
    let current = new Date(start);

    while (current <= today) {
        // نستخدم isWorkDay الموجودة أصلاً في الكود عندك
        if (!this.isWorkDay(current, personName)) {
            count++;
        }
        current.setDate(current.getDate() + 1);
    }
    return count;
},
    
    // أضف هذا داخل dateEngine
countVacationDays(startDate, endDate, person) {
    if (!(startDate instanceof Date) || !(endDate instanceof Date) || isNaN(startDate) || isNaN(endDate)) return 0;
    
    let count = 0;
    let current = new Date(startDate);
    
    // نمر على كل الأيام من البداية للنهاية
    while (current <= endDate) {
        // إذا كان اليوم ليس يوم عمل (بناءً على المنطق الموجود مسبقاً)
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

        // إذا بدأنا في يوم إجازة، نتحرك لأول يوم عمل
        while(!this.isWorkDay(result, person)) {
            result.setDate(result.getDate() + 1);
            result.setHours(CONFIG.START_HOUR, 0, 0, 0);
        }

        while (remainingHours > 0) {
            if (this.isWorkDay(result, person)) {
                let currentHour = result.getHours();
                if (currentHour >= CONFIG.START_HOUR && currentHour < CONFIG.END_HOUR) {
                    // حساب الساعات المتبقية بناءً على إنتاجية الساعات الفعلية
                    remainingHours -= (CONFIG.WORKING_HOURS / (CONFIG.END_HOUR - CONFIG.START_HOUR));
                }
            }
            
            result.setHours(result.getHours() + 1);
            
            // إذا وصلنا لنهاية يوم العمل، ننتقل لليوم التالي الساعة 9 صباحاً
            if (result.getHours() >= CONFIG.END_HOUR) {
                result.setDate(result.getDate() + 1);
                result.setHours(CONFIG.START_HOUR, 0, 0, 0);
                
                // تخطي الإجازات عند الانتقال للأيام التالية
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
    // 1. استدعاء الوظائف الأساسية
    this.renderStats();
    this.renderActiveCards();
    this.renderDelivery();
    this.renderSettings();
    this.renderClientRoadmap();
    this.renderWorkload();

    // 2. إدارة الصلاحيات للمشاهد (Viewer)
    if (currentUser && currentUser.role === 'viewer') {
        const uploadBtn = document.querySelector("button[onclick*='csv-input']");
        if (uploadBtn) uploadBtn.style.display = 'none';
        
        const settingsNav = document.querySelector("button[onclick*='settings']");
        if (settingsNav) settingsNav.style.display = 'none';
    }

    // 3. التعامل مع التبويب النشط (بدون تكرار تعريف المتغير)
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

  renderStats() {
    // --- البيانات الأساسية ---
    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];
    const sevenDaysLater = new Date();
    sevenDaysLater.setDate(now.getDate() + 7);

    // 1. القصص النشطة (ليست في حالة Tested أو Closed)
    const active = currentData.filter(s => s.state !== 'Tested' && s.state !== 'Closed');
    
    // 2. القصص الجاهزة للتسليم (حالتها Tested ولم يتم تسجيل تسليمها بعد)
    const readyForDelivery = currentData.filter(s => 
        (s.state === 'Tested' || s.state === 'Closed') && 
        !db.deliveryLogs.some(log => log.storyId === s.id)
    );
    
    // 3. القصص المتأخرة عن موعدها المحسوب
    const delayed = active.filter(s => {
        return s.calc.finalEnd instanceof Date && 
               !isNaN(s.calc.finalEnd.getTime()) && 
               now > s.calc.finalEnd;
    });

    // --- الإحصائيات الجديدة المضافة بناءً على محتوى الفيوز الأخرى ---

    // أ- إجمالي الـ Bugs المفتوحة في القصص النشطة
    const totalOpenBugs = active.reduce((acc, s) => {
        const openBugs = s.bugs ? s.bugs.filter(b => b.State !== 'Closed' && b.State !== 'Resolved').length : 0;
        return acc + openBugs;
    }, 0);

    // ب- عدد طلبات التغيير (CRs) النشطة
    const activeCRs = active.filter(s => s.type === 'CR').length;

    // ج- تسليمات العميل المتوقعة خلال 7 أيام (Roadmap Stat)
    const upcomingClientDeadlines = currentData.filter(s => {
        return s.expectedRelease instanceof Date && 
               s.state !== 'Tested' && 
               s.expectedRelease >= now && 
               s.expectedRelease <= sevenDaysLater;
    }).length;

    // د- الموظفين في إجازة اليوم (Settings & Vacations Stat)
    const onVacationToday = db.vacations ? db.vacations.filter(v => v.date === todayStr).length : 0;

    // --- بناء محتوى الكروت الأساسية (Stats Cards) ---
    const statsHtml = `
        <div class="bg-blue-600 text-white p-4 rounded-xl shadow">
            <div class="text-sm opacity-80">Active Stories</div>
            <div class="text-2xl font-bold">${active.length} <span class="text-xs font-normal opacity-70">(${activeCRs} CRs)</span></div>
        </div>
        <div class="bg-green-600 text-white p-4 rounded-xl shadow">
            <div class="text-sm opacity-80">Ready for Delivery</div>
            <div class="text-2xl font-bold">${readyForDelivery.length}</div>
        </div>
        <div class="bg-red-600 text-white p-4 rounded-xl shadow">
            <div class="text-sm opacity-80">Delayed</div>
            <div class="text-2xl font-bold">${delayed.length}</div>
        </div>
        <div class="bg-purple-600 text-white p-4 rounded-xl shadow">
            <div class="text-sm opacity-80">Delivered Total</div>
            <div class="text-2xl font-bold">${db.deliveryLogs.length}</div>
        </div>
        
        <div class="bg-amber-500 text-white p-4 rounded-xl shadow">
            <div class="text-sm opacity-80">Open Bugs</div>
            <div class="text-2xl font-bold">${totalOpenBugs}</div>
        </div>
        <div class="bg-indigo-600 text-white p-4 rounded-xl shadow">
            <div class="text-sm opacity-80">Client Deadlines (7d)</div>
            <div class="text-2xl font-bold">${upcomingClientDeadlines}</div>
        </div>
        <div class="bg-teal-600 text-white p-4 rounded-xl shadow">
            <div class="text-sm opacity-80">Staff on Vacation</div>
            <div class="text-2xl font-bold">${onVacationToday}</div>
        </div>
    `;
    
    document.getElementById('stats-cards').innerHTML = statsHtml;

    // --- تحديث قائمة المتأخرات (Overdue Container) ---
    document.getElementById('overdue-container').innerHTML = delayed.map(s => `
        <div class="p-2 border-b text-sm">
            <span class="font-bold">[${s.area}]</span> ${s.title}
            <div class="text-xs text-red-400">Delayed since: ${s.calc.finalEnd.toLocaleDateString()}</div>
        </div>
    `).join('') || '<div class="text-gray-400 text-center py-2">No delayed items</div>';

    // --- تحديث قائمة مهام اليوم (Today Container) ---
    document.getElementById('today-container').innerHTML = active.filter(s => {
        return s.calc.finalEnd instanceof Date && 
               !isNaN(s.calc.finalEnd.getTime()) && 
               s.calc.finalEnd.toISOString().split('T')[0] === todayStr;
    }).map(s => `
        <div class="p-2 border-b text-sm">
            <span class="font-bold">[${s.area}]</span> ${s.title} - <span class="text-blue-500">${s.assignedTo}</span>
        </div>
    `).join('') || '<div class="text-gray-400 text-center py-2">Nothing planned for today</div>';
},

renderClientRoadmap() {
    const container = document.getElementById('roadmap-container');
    const today = new Date();
    const fourteenDaysLater = new Date();
    fourteenDaysLater.setDate(today.getDate() + 14);

    // 1. فلترة القصص التي لها تاريخ تسليم متوقع خلال الـ 14 يوم القادمين وليست منتهية
    const upcomingDeliveries = currentData.filter(s => {
        if (!s.expectedRelease || !(s.expectedRelease instanceof Date)) return false;
        
        // تصفية المهام التي لم تنتهِ بعد (أو انتهت مؤخراً وتريد عرضها)
        const isNotDone = s.state !== 'Tested'; 
        const isWithinRange = s.expectedRelease >= today && s.expectedRelease <= fourteenDaysLater;
        
        return isNotDone && isWithinRange;
    });

    // ترتيب حسب التاريخ الأقرب
    upcomingDeliveries.sort((a, b) => a.expectedRelease - b.expectedRelease);

    if (upcomingDeliveries.length === 0) {
        container.innerHTML = `<div class="col-span-full text-center py-8 bg-white rounded-xl border border-dashed text-gray-400">No client deliveries expected in the next 14 days.</div>`;
        return;
    }

    container.innerHTML = upcomingDeliveries.map(s => {
        const diffTime = Math.abs(s.expectedRelease - today);
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        
        // تحديد لون الكارت بناءً على قرب الموعد
        let urgencyClass = "border-blue-200 bg-white";
        if (diffDays <= 3) urgencyClass = "border-amber-400 bg-amber-50";
        if (diffDays <= 1) urgencyClass = "border-red-400 bg-red-50";

        return `
            <div class="p-4 rounded-xl border-2 ${urgencyClass} shadow-sm">
                <div class="flex justify-between items-start mb-2">
                    <span class="text-[10px] font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded">In ${diffDays} Days</span>
                    <span class="text-[10px] text-gray-400">#${s.id}</span>
                </div>
                <div class="text-sm font-bold text-slate-800 truncate" title="${s.title}">${s.title}</div>
                <div class="text-[11px] text-gray-500 mt-1">Area: ${s.area}</div>
                <div class="mt-3 flex justify-between items-center">
                    <div class="text-[10px] font-bold uppercase text-gray-400">Release:</div>
                    <div class="text-xs font-bold text-slate-700">${s.expectedRelease.toLocaleDateString('en-GB')}</div>
                </div>
                <div class="mt-2 h-1 w-full bg-gray-100 rounded-full overflow-hidden">
                    <div class="h-full bg-indigo-500" style="width: ${s.state === 'Resolved' ? '80%' : '40%'}"></div>
                </div>
            </div>
        `;
    }).join('');
},
    
renderActiveCards() {
    const container = document.getElementById('active-cards-container');
    const searchTerm = document.getElementById('search-input')?.value.toLowerCase() || ""; 
    const tagSearchTerm = document.getElementById('tag-search-input')?.value.toLowerCase() || "";
    
    const activeStories = currentData.filter(s => {
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
                const fixingProgressPercent = totalBugs > 0 ? Math.round((completedBugs / totalBugs) * 100) : 0;

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
                                                <span class="text-[9px] text-red-600 font-bold">${fixingProgressPercent}%</span>
                                            </div>
                                            <div class="w-full bg-gray-100 h-1 rounded-full overflow-hidden">
                                                <div class="bg-red-500 h-full" style="width: ${fixingProgressPercent}%"></div>
                                            </div>
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
    const filterContainer = document.getElementById('kanban-ba-filter'); // أصبح div بدلاً من select

    if (!currentData || currentData.length === 0) return;

    // 1. استخراج جميع المناطق الفريدة وترتيبها
    const areas = [...new Set(currentData.map(s => s.area || "General"))].sort();

    // 2. تهيئة الحالة المخزنة للمناطق المحددة (إن لم تكن موجودة)
    if (!this.selectedAreas) {
        // افتراضياً نختار الكل (أو يمكن تركها فارغة لعرض الكل)
        this.selectedAreas = areas.slice(); // نسخة من جميع المناطق
    }

    // 3. بناء واجهة الفلتر (Dropdown مع checkboxes)
    const filterHtml = `
        <div class="relative inline-block w-full md:w-64" id="filter-dropdown-wrapper">
            <button id="filter-dropdown-btn" class="w-full bg-white border border-gray-300 rounded-lg px-4 py-2 text-left flex items-center justify-between shadow-sm hover:border-indigo-400 transition">
                <span class="text-sm font-medium text-gray-700 truncate">
                    ${this.selectedAreas.length === areas.length ? 'All Areas' : this.selectedAreas.join(', ')}
                </span>
                <svg class="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path>
                </svg>
            </button>
            <div id="filter-dropdown-menu" class="hidden absolute left-0 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg z-50 max-h-60 overflow-y-auto p-2">
                <div class="flex flex-col space-y-1">
                    ${areas.map(area => `
                        <label class="flex items-center space-x-2 cursor-pointer hover:bg-gray-50 px-2 py-1 rounded">
                            <input type="checkbox" class="area-checkbox" value="${area}" 
                                ${this.selectedAreas.includes(area) ? 'checked' : ''}>
                            <span class="text-sm text-gray-700">${area}</span>
                        </label>
                    `).join('')}
                </div>
                <div class="border-t border-gray-200 mt-2 pt-2 flex justify-between">
                    <button id="select-all-areas" class="text-xs text-indigo-600 hover:text-indigo-800 font-medium">Select All</button>
                    <button id="clear-all-areas" class="text-xs text-red-500 hover:text-red-700 font-medium">Clear All</button>
                </div>
            </div>
        </div>
    `;

    // استبدال محتوى حاوية الفلتر بالعنصر الجديد
    filterContainer.innerHTML = filterHtml;

    // 4. إضافة السلوكيات (إظهار/إخفاء القائمة، التعامل مع التغييرات)
    const dropdownBtn = document.getElementById('filter-dropdown-btn');
    const dropdownMenu = document.getElementById('filter-dropdown-menu');
    const checkboxes = document.querySelectorAll('.area-checkbox');
    const selectAllBtn = document.getElementById('select-all-areas');
    const clearAllBtn = document.getElementById('clear-all-areas');

    // تبديل إظهار القائمة عند النقر على الزر
    dropdownBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        dropdownMenu.classList.toggle('hidden');
    });

    // إغلاق القائمة عند النقر في أي مكان خارجها
    document.addEventListener('click', (e) => {
        if (!filterContainer.contains(e.target)) {
            dropdownMenu.classList.add('hidden');
        }
    });

    // دالة لتحديث التحديدات وإعادة الرندر
    const updateSelection = () => {
        const checkedAreas = [];
        document.querySelectorAll('.area-checkbox:checked').forEach(cb => {
            checkedAreas.push(cb.value);
        });
        this.selectedAreas = checkedAreas.length > 0 ? checkedAreas : areas; // إذا لم يتم اختيار أي شيء نعرض الكل

        // تحديث النص الظاهر على الزر
        const btnText = document.querySelector('#filter-dropdown-btn span');
        if (this.selectedAreas.length === areas.length) {
            btnText.textContent = 'All Areas';
        } else if (this.selectedAreas.length === 1) {
            btnText.textContent = this.selectedAreas[0];
        } else {
            btnText.textContent = this.selectedAreas.join(', ');
        }

        // إعادة رسم الـ Kanban بناءً على التحديدات الجديدة
        this.renderKanban();
    };

    // إضافة مستمعي الأحداث لكل checkbox
    checkboxes.forEach(cb => {
        cb.addEventListener('change', updateSelection);
    });

    // زر تحديد الكل
    if (selectAllBtn) {
        selectAllBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            document.querySelectorAll('.area-checkbox').forEach(cb => cb.checked = true);
            updateSelection();
        });
    }

    // زر إلغاء الكل
    if (clearAllBtn) {
        clearAllBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            document.querySelectorAll('.area-checkbox').forEach(cb => cb.checked = false);
            updateSelection();
        });
    }

    // 5. تحديد المناطق المختارة فعلياً للتصفية
    let selectedAreasForFilter = this.selectedAreas;
    if (selectedAreasForFilter.length === 0) {
        selectedAreasForFilter = areas; // عرض الكل إذا كانت فارغة
    }

    // 6. تصفية القصص بناءً على المناطق المحددة
    const filteredStories = currentData.filter(s => selectedAreasForFilter.includes(s.area || "General"));

    // 7. تعريف الحالات (الأعمدة)
    const states = ["Active", "Active - With Bugs", "Resolved", "Tested", "On-Hold"];

    // 8. بناء الأعمدة
    container.innerHTML = states.map(state => {
        const storiesInState = filteredStories.filter(s => s.state === state);
        
        return `
            <div class="flex-shrink-0 w-80 bg-gray-50 rounded-xl border border-gray-200 flex flex-col max-h-screen">
                <div class="p-3 border-b flex justify-between items-center bg-white rounded-t-xl">
                    <h3 class="font-bold text-slate-700">${state}</h3>
                    <span class="bg-gray-200 text-gray-700 text-xs px-2 py-0.5 rounded-full">${storiesInState.length}</span>
                </div>
                <div class="p-2 space-y-3 overflow-y-auto">
                    ${storiesInState.map(s => {
                        // حساب الاستميشن للتطوير
                        const devTasks = s.tasks.filter(t => ["Development", "DB Modification"].includes(t['Activity']));
                        const devEstTotal = devTasks.reduce((acc, t) => acc + parseFloat(t['Original Estimation'] || 0), 0);
                        const devEstCompleted = devTasks.filter(t => !['New', 'Active'].includes(t['State']))
                                                                        .reduce((acc, t) => acc + parseFloat(t['Original Estimation'] || 0), 0);
                        const devEstRemaining = Math.max(0, devEstTotal - devEstCompleted);

                        // حساب الاستميشن للتستر
                        const testEst = s.tasks.filter(t => t['Activity'] === 'Testing')
                                                              .reduce((acc, t) => acc + parseFloat(t['Original Estimation'] || 0), 0);
                        
                        // معالجة التاجز (Tags)
                        const tagsList = s.tags ? (typeof s.tags === 'string' ? s.tags.split(';') : s.tags) : [];

                        // البجز
                        const totalBugs = s.bugs ? s.bugs.length : 0;
                        const completedBugs = s.bugs ? s.bugs.filter(b => ['Closed', 'Resolved'].includes(b['State'])).length : 0;

                        // تست كيسز
                        const testCases = s.testCases || [];
                        const totalTC = testCases.length;
                        const completedTC = testCases.filter(tc => ['Pass', 'Fail', 'Not Applicable'].includes(tc.state)).length;

                        // عدد التعليقات
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
    // جلب نص البحث وتحويله لحروف صغيرة
    const searchTerm = document.getElementById('search-delivery-input')?.value.toLowerCase() || ""; 
    
    // 1. جلب كل الستوريز التي حالتها المختبرة
    const allTested = currentData.filter(s => s.state === 'Tested' || s.state === 'Closed');

    // 2. الفلترة للقصص بانتظار التسليم (مع البحث)
    const pendingStories = allTested.filter(s => {
        const isPending = !db.deliveryLogs.some(l => l.storyId === s.id.toString());
        const matchesSearch = 
            s.title.toLowerCase().includes(searchTerm) || 
            s.id.toString().includes(searchTerm) || 
            (s.area && s.area.toLowerCase().includes(searchTerm));
        return isPending && matchesSearch;
    });
    

    
    // 3. الفلترة للقصص التي تم تسليمها (مع البحث)
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

    // حذف اللوج القديم لإعادته لقائمة "بانتظار التسليم"
    const confirmEdit = confirm("هل تريد إلغاء التسليم الحالي وتعديله؟");
    if (confirmEdit) {
        db.deliveryLogs = db.deliveryLogs.filter(log => log.storyId.toString() !== id.toString());
        
        // حفظ التغييرات في GitHub
        dataProcessor.saveToGitHub().then(() => {
            this.renderDelivery();
            // تركيز تلقائي على حقل الإدخال الجديد بعد إعادة الرندر
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

    const areaGroups = {};
    const MAX_HOURS = 65;

    // --- 1. حساب الانشغال العالمي (للمناطق الأخرى) ---
    const globalTaskWorkers = new Set();
    currentData.forEach(story => {
        const activeTasks = (story.tasks || []).filter(t => 
            t['State'] !== 'To Be Reviewed' && t['State'] !== 'Closed' && 
            parseFloat(t['Original Estimation'] || 0) > 0
        );
        activeTasks.forEach(t => {
            const worker = (t['Activity'] === 'Testing') ? story.tester : story.assignedTo;
            if (worker && worker !== "Unassigned") globalTaskWorkers.add(worker);
        });
    });

    // --- 2. تحديد العاملين على الدعم والبجات (عالمياً) ---
    const supportWorkersGlobal = new Set();
    const bugWorkersGlobal = new Set();

    // العاملين على Support Log (القصص النشطة من نوع Support Log)
    currentData.forEach(story => {
        if (story.type === 'Support Log' && story.state !== 'Tested' && story.state !== 'Closed') {
            if (story.assignedTo && story.assignedTo !== "Unassigned") supportWorkersGlobal.add(story.assignedTo);
            if (story.tester && story.tester !== "Unassigned") supportWorkersGlobal.add(story.tester);
        }
    });

    // العاملين على Bugs (التي حالتها New أو Active)
    // مع ملاحظة: سنعطي الأولوية للدعم عند العرض، لذا لا نحتاج لاستبعادهم هنا.
    currentData.forEach(story => {
        if (story.bugs && story.bugs.length > 0) {
            story.bugs.forEach(bug => {
                if (['New', 'Active'].includes(bug['State'])) {
                    const worker = bug['Assigned To'];
                    if (worker && worker !== "Unassigned") bugWorkersGlobal.add(worker);
                }
            });
        }
    });

    // --- 3. بناء areaGroups (جمع البيانات الأساسية) ---
    currentData.forEach(story => {
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

    // --- 4. دالة مساعدة لعرض اسم مع علامة BUSY ---
    const renderAvailableTag = (name) => {
        const isBusyGlobally = globalTaskWorkers.has(name);
        return `
            <span class="px-3 py-1.5 bg-white border border-slate-200 text-slate-600 text-[10px] font-bold rounded-full shadow-sm hover:border-emerald-300 hover:text-emerald-600 transition-colors flex items-center gap-1.5">
                ${name}
                ${isBusyGlobally ? '<span class="text-[8px] bg-amber-100 text-amber-600 px-1.5 py-0.5 rounded shadow-sm font-black ring-1 ring-amber-200">BUSY</span>' : ''}
            </span>`;
    };

    // --- 5. بناء واجهة العرض (الكارت) ---
    const areaEntries = Object.entries(areaGroups);

    container.innerHTML = areaEntries.map(([areaName, data], index) => {
        // ---- حساب WIP (يعتمد على القصص، وليس على المتاحين) ----
        const activeDevs = Object.keys(data.activeDevStories).filter(name => data.activeDevStories[name] > 0);
        const activeDevsCount = activeDevs.length;

        const storiesInArea = currentData.filter(s => (s.area || "General Business Area") === areaName);
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

        // ---- تحديد العاملين على الدعم والبجات في هذه المنطقة (مع إعطاء أولوية للدعم) ----
        const allWorkers = new Set([...data.allDevsInArea, ...data.allTestersInArea]);
        const supportWorkersInArea = [];
        const bugWorkersInArea = [];
        allWorkers.forEach(worker => {
            if (supportWorkersGlobal.has(worker)) {
                supportWorkersInArea.push(worker);  // أولوية الدعم
            } else if (bugWorkersGlobal.has(worker)) {
                bugWorkersInArea.push(worker);
            }
        });

        // ---- تحديد المتاحين (المطورين والمختبرين) بعد استبعاد مشغولي الدعم والبجات ----
        const availableDevs = [...data.allDevsInArea]
            .filter(name => !data.developers[name])
            .filter(name => !supportWorkersGlobal.has(name) && !bugWorkersGlobal.has(name));

        const availableTesters = [...data.allTestersInArea]
            .filter(name => !data.testers[name])
            .filter(name => !supportWorkersGlobal.has(name) && !bugWorkersGlobal.has(name));

        // ---- إذا كان نفس الاسم موجوداً في المطورين والمختبرين، نضعه فقط في المختبرين ----
        const finalAvailableDevs = availableDevs.filter(name => !availableTesters.includes(name));

        // ---- توليد HTML الكامل للكارت ----
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

                    <!-- Working On Support + Working On Bugs (مع أولوية الدعم) -->
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

    // --- 6. عرض النافذة فقط إذا كان التبويب النشط هو Workload ---
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
    // إنشاء النافذة إذا لم تكن موجودة
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

    // ملء المحتوى
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

    // إظهار النافذة
    modal.style.display = 'flex';
},
    // --- وظائف السحب والإفلات ---

    handleAreaDragStart(event, index) {
        event.dataTransfer.setData('text/plain', index);
        // إضافة تأثير بصري عند السحب
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

        // 1. الحصول على قائمة بأسماء المناطق الحالية بالترتيب الحالي
        const currentAreas = Array.from(new Set(currentData.map(s => s.area || "General Business Area")));
        
        // 2. إعادة ترتيب الأسماء في المصفوفة
        const movedAreaName = currentAreas.splice(sourceIndex, 1)[0];
        currentAreas.splice(targetIndex, 0, movedAreaName);

        // 3. إعادة ترتيب currentData بناءً على ترتيب الأسماء الجديد
        const reorderedData = [];
        currentAreas.forEach(areaName => {
            const storiesInArea = currentData.filter(s => (s.area || "General Business Area") === areaName);
            reorderedData.push(...storiesInArea);
        });

        // 4. تحديث البيانات وإعادة الرندر
        currentData = reorderedData;
        this.renderWorkload();
        
        // اختياري: حفظ الترتيب في السيرفر/GitHub إذا أردت استمراريته
        // dataProcessor.saveToGitHub();
    },
   
openStoryModal(storyId) {
        const s = currentData.find(item => item.id.toString() === storyId.toString());
        if (!s) return;

        const modal = document.getElementById('story-modal');
        const title = document.getElementById('modal-title');
        const body = document.getElementById('modal-body');

        title.innerText = `[#${s.id}] ${s.title}`;
        
        // حسابات التقدم للعرض بالتفصيل
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

        modal.classList.remove('hidden');
        document.body.style.overflow = 'hidden'; // منع السكرول في الخلفية
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

    // التركيز التلقائي على حقل الإدخال لسهولة الكتابة
    setTimeout(() => {
        const input = document.getElementById('kanban-comment-input');
        if (input) input.focus();
    }, 100);
},
     
    
renderDailyActivity() {
        const container = document.getElementById('daily-activity-container');
        if (!container) return;

        const today = new Date();
        const todayStr = today.toISOString().split('T')[0];
        const activities = [];

        // 1. فلترة البيانات لعرض تحديثات اليوم فقط (Stories أو Tasks)
        currentData.forEach(story => {
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

        // 2. تجميع البيانات للهيكل التفصيلي (Grouping)
        // نقوم بالتجميع أولاً لنستخدم النتائج في الشارت والتفاصيل معاً
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

        // 3. إنشاء الشارت العلوي باستخدام البيانات المجمعة لضمان تطابق الأرقام
        let html = this.renderDailyActivitySummary(activities, grouped);

        // 4. بناء محتوى التفاصيل
        html += `<div class="space-y-6 mt-6">`;
        for (const branch in grouped) {
            // حساب عدد العناصر في هذا الفرع بناءً على الفلتر اليومي
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
        
        // 1. حساب الحالات (States)
        const states = activities.reduce((acc, s) => { 
            acc[s.state] = (acc[s.state] || 0) + 1; 
            return acc; 
        }, {});

        // 2. حساب إحصائيات الفروع (Branches) من الـ activities مباشرة لضمان التطابق
        const branchStatsMap = {};
        activities.forEach(s => {
            const branchName = s.branch || "Unknown";
            branchStatsMap[branchName] = (branchStatsMap[branchName] || 0) + 1;
        });
        const branchStats = Object.entries(branchStatsMap)
            .map(([name, count]) => ({ name, count }))
            .sort((a, b) => b.count - a.count);

        // 3. حساب إحصائيات المناطق (Areas) من الـ activities مباشرة
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

    // 1. تجميع الأنشطة التي تمت اليوم (نفس منطق العرض في الفيو تماماً)
    currentData.forEach(story => {
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

    // 2. تنظيم البيانات في مجموعات هرمية (Branch -> Area -> Customer)
    const grouped = activities.reduce((acc, item) => {
        if (!acc[item.branch]) acc[item.branch] = {};
        if (!acc[item.branch][item.area]) acc[item.branch][item.area] = {};
        if (!acc[item.branch][item.area][item.customer]) acc[item.branch][item.area][item.customer] = [];
        acc[item.branch][item.area][item.customer].push(item);
        return acc;
    }, {});

    // 3. بناء محتوى الملف مع دعم اللغة العربية والترتيب الهرمي
    let csvContent = "\uFEFF"; // BOM لدعم اللغة العربية في Excel
    csvContent += "Level,Identifier,Details/Title,Owner,Status\n"; 

    for (const branch in grouped) {
        let branchCount = 0;
        Object.values(grouped[branch]).forEach(area => {
            Object.values(area).forEach(cust => branchCount += cust.length);
        });
        
        // إضافة سطر الفرع
        csvContent += `BRANCH,${branch},Total Items: ${branchCount},,\n`;

        for (const area in grouped[branch]) {
            let areaCount = 0;
            Object.values(grouped[branch][area]).forEach(cust => areaCount += cust.length);
            
            // إضافة سطر المنطقة
            csvContent += `AREA,${area},Sub-total: ${areaCount},,\n`;

            for (const customer in grouped[branch][area]) {
                const customerStories = grouped[branch][area][customer];
                
                // إضافة سطر العميل
                csvContent += `CUSTOMER,${customer},Items: ${customerStories.length},,\n`;

                // إضافة الستوريز الخاصة بهذا العميل
                customerStories.forEach(s => {
                    csvContent += `STORY,#${s.id},"${s.title.replace(/"/g, '""')}",${s.assignedTo},${s.state}\n`;
                });
            }
        }
        csvContent += ",,,,\n"; // سطر فارغ للفصل بين الفروع
    }

    // 4. تحميل الملف بصيغة CSV المتوافقة مع Excel
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

    // 1. الفلترة
    const inactive = currentData.filter(s => {
        const isActive = s.state !== 'Tested' && s.state !== 'Closed';
        const lastChange = s.changedDate ? new Date(s.changedDate) : null;
        return isActive && (!lastChange || lastChange < today);
    });

    if (inactive.length === 0) {
        container.innerHTML = `<div class="col-span-full text-center py-10 text-gray-400">All active stories have been updated today! 🎉</div>`;
        return;
    }

    // 2. التجميع حسب الـ Area
    const groupedByArea = inactive.reduce((groups, story) => {
        const areaName = story.area || "General";
        if (!groups[areaName]) groups[areaName] = [];
        groups[areaName].push(story);
        return groups;
    }, {});

    let html = '';
    const now = new Date();

    for (const area in groupedByArea) {
        // عنوان الـ Area
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
        const staff = [...new Set(currentData.map(s => s.assignedTo).concat(currentData.map(s => s.tester)))];
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
        },
    
    // NEW: Auditor Checklist Renderer
    renderAuditorChecklist() {
        const tbody = document.getElementById('auditor-table-body');
        if (!tbody) return;

        // Get filter values
        const areaFilter = document.getElementById('auditor-area-filter')?.value || 'all';
        const stateFilter = document.getElementById('auditor-state-filter')?.value || 'all';

        // Populate area filter dropdown if empty
        const areaSelect = document.getElementById('auditor-area-filter');
        if (areaSelect && areaSelect.options.length <= 1) {
            const areas = [...new Set(currentData.map(s => s.area || "General"))];
            areaSelect.innerHTML = '<option value="all">All Areas</option>' + areas.map(a => `<option value="${a}">${a}</option>`).join('');
        }

        // Filter stories
        let filtered = currentData;
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

        // Evaluate each story against 7 criteria
        const rowsHtml = filtered.map(story => {
            const criteria = this.evaluateStoryCompliance(story);
            const compliancePercent = Math.round((criteria.passedCount / criteria.totalCount) * 100);
            
            // Determine progress bar color
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

        // 1. Business Priority valid (not empty and not default 999)
        const priorityValid = story.priority && story.priority !== 999 && !isNaN(story.priority);
        if (priorityValid) passedCount++;

        // 2. Iteration Path contains numbers or slashes (indicates iteration format)
        const iterationPathValid = story.iterationPath && /[\d\/]/.test(story.iterationPath);
        if (iterationPathValid) passedCount++;

        // 3. Development Tasks: exists at least one Development/DB Modification task
        const devTasksList = story.tasks.filter(t => ["Development", "DB Modification"].includes(t['Activity']));
        let devTasksValid = devTasksList.length > 0;
        // If story is Tested or Closed, all dev tasks must be closed
        if ((story.state === 'Tested' || story.state === 'Closed') && devTasksValid) {
            const allDevClosed = devTasksList.every(t => ['Closed', 'Resolved'].includes(t['State']));
            devTasksValid = allDevClosed;
        }
        if (devTasksValid) passedCount++;

        // 4. Testing Tasks: exists at least one Testing task OR task title contains Prep/Preparation
        const testTasksList = story.tasks.filter(t => 
            t['Activity'] === 'Testing' || 
            (t['Title'] && (t['Title'].toLowerCase().includes('prep') || t['Title'].toLowerCase().includes('preparation')))
        );
        const testTasksValid = testTasksList.length > 0;
        if (testTasksValid) passedCount++;

        // 5. Test Cases: must exist and all have state 'Pass'
        const testCases = story.testCases || [];
        const testCasesValid = testCases.length > 0 && testCases.every(tc => tc.state === 'Pass' || tc.state === 'Not Applicable');
        if (testCasesValid) passedCount++;

        // 6. Bugs Closed: if story is Tested/Closed, all bugs must be closed; otherwise ignore
        let bugsValid = true;
        if (story.state === 'Tested' || story.state === 'Closed') {
            const bugs = story.bugs || [];
            bugsValid = bugs.length === 0 || bugs.every(b => ['Closed', 'Resolved', 'Cancel'].includes(b['State']));
        }
        if (bugsValid) passedCount++;

        // 7. Reviews Closed: if reviews exist, they must be closed; otherwise consider as passed (no reviews required)
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
    // إضافة تاج جديد للسيستم
    addTag() {
        const input = document.getElementById('new-tag-input');
        const tagName = input.value.trim();
        if(!tagName || db.customTags.includes(tagName)) return;
        
        db.customTags.push(tagName);
        input.value = '';
        dataProcessor.saveToGitHub();
        this.renderTagsSettings();
        ui.renderAll(); // لتحديث القوائم في الكروت
    },

    // حذف تاج من السيستم
    removeTag(tagName) {
        db.customTags = db.customTags.filter(t => t !== tagName);
        // مسح التاج من أي ستوري كانت مرتبطة به
        db.currentStories.forEach(s => { if(s.customTag === tagName) delete s.customTag; });
        dataProcessor.saveToGitHub();
        this.renderTagsSettings();
       ui.renderAll();
    },

    // ربط تاج بستوري معينة
    assignTagToStory(storyId, tagName) {
        const story = db.currentStories.find(s => s.ID == storyId);
        if(story) {
            story.customTag = tagName;
            dataProcessor.saveToGitHub();
        }
    },

    // عرض التاجز في صفحة الإعدادات
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
    // البحث عن الـ Story باستخدام الـ ID في قاعدة البيانات المركزية
    const story = db.currentStories.find(s => (s.id || s.ID || s.idReadable) == storyId);
    
    if (story) {
        // التأكد من وجود مصفوفة الوسوم في كائن الـ Story
        if (!story.customTags) {
            story.customTags = [];
        }
        
        const index = story.customTags.indexOf(tagName);
        if (index > -1) {
            // إذا كان التاج موجوداً بالفعل، نقوم بإزالته
            story.customTags.splice(index, 1);
        } else {
            // إذا لم يكن موجوداً، نقوم بإضافته
            story.customTags.push(tagName);
        }
        
        // استدعاء وظيفة الحفظ المباشر إلى GitHub لضمان الاستمرارية
        dataProcessor.saveToGitHub();
        
        // تحديث الواجهة فوراً ليعكس التغيير
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
            
            const now = new Date();
            const dateStr = now.toLocaleDateString('en-GB'); // بصيغة DD/MM/YYYY
            
            // إضافة التعليق الجديد مع التاريخ
            story.standupComments.push({
                text: text,
                date: now.toLocaleString('en-GB'),
                timestamp: now.getTime()
            });

            // حفظ التغييرات فوراً إلى GitHub
            dataProcessor.saveToGitHub();
            
            // تحديث الواجهة لإظهار التعليق في الـ Log
            ui.renderActiveCards(); 
        }
    }
};
// استدعاء الرندر عند تحميل الإعدادات
// أضف tagManager.renderTagsSettings() داخل وظيفة ui.renderSettings

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
const azureDevOps = {
    async sync() {
        const pat = sessionStorage.getItem('az_pat');
        const settings = JSON.parse(localStorage.getItem('az_settings')) || {
            org: "NTDotNet",
            project: "LDM",
            queryId: "8a732680-07a6-4dff-bdbd-7800644f61b9"
        };

        if (!pat) return alert("Azure PAT is missing. Please login again.");

        const syncBtn = document.querySelector("button[onclick='azureDevOps.sync()']");
        syncBtn.innerText = "⏳ Syncing...";
        syncBtn.disabled = true;

        try {
            const authHeader = 'Basic ' + btoa(':' + pat);
            
            // 1. Get Work Item IDs from Query
            const queryUrl = `https://dev.azure.com/${settings.org}/${settings.project}/_apis/wit/wiql/${settings.queryId}?api-version=6.0`;
            const queryRes = await fetch(queryUrl, { headers: { 'Authorization': authHeader } });
            const queryData = await queryRes.json();

            // التعرف على العلاقات (Work Item Relations) كما في ملف الـ TXT
            const relations = queryData.workItemRelations || [];
            const allIds = [...new Set(relations.map(r => r.target ? r.target.id : null).filter(id => id))];

            if (allIds.length === 0) throw new Error("No items found in the specified query.");

            // 2. Fetch Details in Batches (Max 200 per request)
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

            // 3. Map Azure Fields to Internal Format
            const rows = this.buildRowsFromRelations(relations, allDetails);
            dataProcessor.processRows(rows);

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

    buildRowsFromRelations(relations, details) {
        const detailsMap = new Map(details.map(d => [d.id, d.fields]));
        const rows = [];

        // نقوم بترتيب الصفوف بناءً على تسلسل العلاقات (Parent then Children)
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

    saveSettings() {
        const settings = {
            org: document.getElementById('az-org').value,
            project: document.getElementById('az-project').value,
            queryId: document.getElementById('az-query-id').value
        };
        localStorage.setItem('az_settings', JSON.stringify(settings));
        alert("تم حفظ إعدادات Azure بنجاح");
    }
};
