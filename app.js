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
    currentStories: []
};

let currentData = []; 
let currentUser = null;

const archiver = {
    async runArchive() {
        const TenDaysAgo = Date.now() - (10 * 24 * 60 * 60 * 1000);
        
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
        const rem = document.getElementById('remember-me').checked;

        if(!u || !p || !t) return alert("برجاء ملء جميع البيانات");

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
        sessionStorage.setItem('gh_token', t);
        if(rem) localStorage.setItem('saved_creds', JSON.stringify({u, p, t}));
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
        if (itemType === 'User Story' || itemType === 'CR') {
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
                calc: {},
                customTags: [], 
                standupComments: []
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
        }
    });

    this.calculateTimelines(newStories);
    db.currentStories = newStories; // الآن المصفوفة تحتوي على القصص المحدثة مع الحفاظ على التاجات
    this.saveToGitHub().then(() => alert("تم تحديث البيانات مع الحفاظ على الكستم تاج بنجاح"));
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
    const MAX_HOURS = 50;

    // --- 1. حساب الانشغال العالمي (Global Tracking) ---
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

    // --- 2. تجميع البيانات الأصلية وتحديد العاملين على البجات ---
    const bugWorkersGlobal = new Set();
    currentData.forEach(story => {
        const area = story.area || "General Business Area";
        if (!areaGroups[area]) {
            areaGroups[area] = { 
                developers: {}, 
                testers: {}, 
                allDevsInArea: new Set(), 
                allTestersInArea: new Set() 
            };
        }

        if (story.assignedTo && story.assignedTo !== "Unassigned") areaGroups[area].allDevsInArea.add(story.assignedTo);
        if (story.tester && story.tester !== "Unassigned") areaGroups[area].allTestersInArea.add(story.tester);

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

        if (story.bugs && story.bugs.length > 0) {
            story.bugs.forEach(bug => {
                if (['New', 'Active'].includes(bug['State'])) {
                    const worker = bug['Assigned To'];
                    if (worker && worker !== "Unassigned") bugWorkersGlobal.add(worker);
                }
            });
        }
    });

    // --- 3. التعامل مع ترتيب الـ Areas (دعم السحب والإفلات) ---
    // إذا لم يكن هناك ترتيب مخزن مسبقاً، نستخدم الترتيب الافتراضي
    if (!db.areaOrder) {
        db.areaOrder = Object.keys(areaGroups);
    }
    
    // تأكد من إضافة أي Area جديدة قد تظهر في البيانات ولم تكن في الترتيب المخزن
    Object.keys(areaGroups).forEach(area => {
        if (!db.areaOrder.includes(area)) db.areaOrder.push(area);
    });

    // --- 4. بناء واجهة العرض ---
    container.innerHTML = db.areaOrder.filter(areaName => areaGroups[areaName]).map(areaName => {
        const data = areaGroups[areaName];
        const rawAvailableDevs = [...data.allDevsInArea].filter(name => !data.developers[name]);
        const rawAvailableTesters = [...data.allTestersInArea].filter(name => !data.testers[name]);

        const workingOnBugs = [];
        const finalAvailableDevs = [];
        const finalAvailableTesters = [];

        rawAvailableDevs.forEach(name => {
            if (bugWorkersGlobal.has(name)) workingOnBugs.push({ name, role: 'Developer' });
            else finalAvailableDevs.push(name);
        });

        rawAvailableTesters.forEach(name => {
            if (bugWorkersGlobal.has(name)) workingOnBugs.push({ name, role: 'Tester' });
            else finalAvailableTesters.push(name);
        });

        const renderAvailableTag = (name) => {
            const isBusyElsewhere = bugWorkersGlobal.has(name) || globalTaskWorkers.has(name);
            const flag = isBusyElsewhere 
                ? `<span class="ml-1.5 text-[8px] bg-amber-100 text-amber-600 px-1 rounded shadow-sm italic font-black ring-1 ring-amber-200">BUSY</span>` 
                : '';
            
            return `
                <span class="px-3 py-1 bg-white border ${isBusyElsewhere ? 'border-amber-200 shadow-amber-50' : 'border-slate-200'} text-slate-600 text-[10px] font-bold rounded-full shadow-sm hover:border-emerald-300 hover:text-emerald-600 transition-colors flex items-center">
                    ${name}${flag}
                </span>`;
        };

        return `
            <div class="workload-area-card mb-16 bg-white rounded-[3rem] shadow-2xl shadow-slate-200/50 overflow-hidden border border-slate-100 transition-all duration-300"
                 draggable="true" 
                 data-area-name="${areaName}"
                 onsubmit="return false;"
                 ondragstart="ui.handleAreaDragStart(event)" 
                 ondragover="ui.handleAreaDragOver(event)" 
                 ondrop="ui.handleAreaDrop(event)">
                
                <div class="bg-gradient-to-r from-slate-800 to-slate-900 p-6 px-10 flex justify-between items-center cursor-move">
                    <div>
                        <h2 class="text-2xl font-black text-white tracking-tight flex items-center gap-3">
                            <i class="fas fa-grip-vertical text-slate-500 text-xs mr-2"></i>
                            <span class="w-4 h-4 bg-indigo-500 rounded-full shadow-[0_0_10px_rgba(99,102,241,0.8)]"></span>
                            ${areaName}
                        </h2>
                        <p class="text-slate-400 text-[10px] uppercase tracking-[0.2em] font-bold mt-1">Resource Allocation & Availability</p>
                    </div>
                </div>

                <div class="p-10 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-8 pointer-events-none child-pointer-events-auto">
                    <div class="space-y-6 pointer-events-auto">
                        <div class="flex items-center gap-2 pb-2 border-b-2 border-indigo-100">
                            <i class="fas fa-code text-indigo-600"></i>
                            <h3 class="text-slate-800 font-black text-sm uppercase">Active Developers</h3>
                        </div>
                        ${this.generateStaffBars(data.developers, 'indigo', MAX_HOURS)}
                    </div>

                    <div class="space-y-6 pointer-events-auto">
                        <div class="flex items-center gap-2 pb-2 border-b-2 border-emerald-100">
                            <i class="fas fa-vial text-emerald-600"></i>
                            <h3 class="text-slate-800 font-black text-sm uppercase">Active Testers</h3>
                        </div>
                        ${this.generateStaffBars(data.testers, 'emerald', MAX_HOURS)}
                    </div>

                    <div class="space-y-6 pointer-events-auto">
                        <div class="flex items-center gap-2 pb-2 border-b-2 border-amber-100">
                            <i class="fas fa-bug text-amber-600"></i>
                            <h3 class="text-slate-800 font-black text-sm uppercase">Working On Bugs</h3>
                        </div>
                        <div class="space-y-3">
                            ${workingOnBugs.length > 0 ? workingOnBugs.map(worker => `
                                <div class="flex items-center justify-between p-3 bg-amber-50 rounded-xl border border-amber-100">
                                    <div class="flex items-center gap-3">
                                        <div class="w-8 h-8 rounded-full bg-white flex items-center justify-center text-amber-600 font-bold text-xs border border-amber-200">
                                            ${worker.name.charAt(0)}
                                        </div>
                                        <div>
                                            <div class="text-xs font-bold text-slate-700">${worker.name}</div>
                                            <div class="text-[9px] text-amber-600 uppercase font-bold">${worker.role}</div>
                                        </div>
                                    </div>
                                    <span class="text-[10px] bg-amber-200 text-amber-800 px-2 py-0.5 rounded-full font-bold">Bugs Found</span>
                                </div>
                            `).join('') : '<div class="text-slate-400 text-xs italic p-4 text-center">لا يوجد أحد</div>'}
                        </div>
                    </div>

                    <div class="bg-slate-50 rounded-3xl p-6 border-2 border-dashed border-slate-200 pointer-events-auto">
                        <div class="flex items-center gap-2 mb-6">
                            <div class="w-8 h-8 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-600">
                                <i class="fas fa-user-check text-xs"></i>
                            </div>
                            <h3 class="text-slate-800 font-black text-sm uppercase">Available For Tasks</h3>
                        </div>
                        <div class="space-y-4">
                            <div>
                                <p class="text-[9px] font-bold text-slate-400 uppercase mb-2 tracking-widest">Developers</p>
                                <div class="flex flex-wrap gap-2">
                                    ${finalAvailableDevs.length > 0 ? finalAvailableDevs.map(name => renderAvailableTag(name)).join('') : '<span class="text-[10px] text-slate-300 italic">None</span>'}
                                </div>
                            </div>
                            <div>
                                <p class="text-[9px] font-bold text-slate-400 uppercase mb-2 tracking-widest">Testers</p>
                                <div class="flex flex-wrap gap-2">
                                    ${finalAvailableTesters.length > 0 ? finalAvailableTesters.map(name => renderAvailableTag(name)).join('') : '<span class="text-[10px] text-slate-300 italic">None</span>'}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }).join('');
},
// دالة مساعدة لرسم الأعمدة داخل كل منطقة
generateStaffBars(staffData, color, max) {
    const entries = Object.entries(staffData);
    if (entries.length === 0) return `<div class="text-gray-300 text-sm italic italic">No active tasks</div>`;

    return entries.sort((a,b) => b[1] - a[1]).map(([name, hours]) => {
        const perc = Math.min((hours / max) * 100, 100);
        const isOver = hours > max;
        const barColor = isOver ? 'bg-red-500' : (perc > 80 ? 'bg-orange-500' : `bg-${color}-500`);

        return `
            <div class="relative">
                <div class="flex justify-between mb-1.5 items-end">
                    <span class="font-bold text-slate-700">${name}</span>
                    <span class="text-xs font-mono ${isOver ? 'text-red-600 font-black' : 'text-slate-500'}">
                        ${hours.toFixed(1)} <span class="text-[10px]">/ ${max}h</span>
                    </span>
                </div>
                <div class="w-full bg-gray-100 rounded-full h-3">
                    <div class="${barColor} h-3 rounded-full transition-all duration-1000 shadow-sm" style="width: ${perc}%"></div>
                </div>
            </div>
        `;
    }).join('');
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
      handleDragStart(e) {
        // تخزين اسم الـ Area التي يتم سحبها
        e.dataTransfer.setData("text/plain", e.currentTarget.getAttribute("data-area"));
        e.currentTarget.style.opacity = "0.4";
    },

    handleDragOver(e) {
        // السماح بالإفلات
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
    },

    handleDrop(e) {
        e.preventDefault();
        const draggedArea = e.dataTransfer.getData("text/plain");
        const targetArea = e.currentTarget.getAttribute("data-area");
        
        if (draggedArea !== targetArea) {
            this.reorderAreas(draggedArea, targetArea);
        }
        e.currentTarget.style.opacity = "1";
    },

    reorderAreas(draggedArea, targetArea) {
        // منطق إعادة الترتيب في قاعدة البيانات
        // إذا كنت تعتمد على مصفوفة معينة للترتيب في db، قم بتحديثها هنا
        console.log(`Moving ${draggedArea} to ${targetArea}`);
        
        // مثال: إذا كان لديك مصفوفة ترتيب في الـ db
        // const index1 = db.areaOrder.indexOf(draggedArea);
        // const index2 = db.areaOrder.indexOf(targetArea);
        // db.areaOrder.splice(index2, 0, db.areaOrder.splice(index1, 1)[0]);
        
        // بعد التغيير، قم بحفظ البيانات ورندر الواجهة مرة أخرى
        // dataProcessor.saveToGitHub();
        this.renderWorkload();
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
        auth.handleLogin();
    }
};
