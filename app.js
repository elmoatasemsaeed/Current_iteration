/**
 * Configuration & Global State 
 */
const CONFIG = {
    REPO_NAME: "elmoatasemsaeed/Current_iteration",
    FILE_PATH: "db.json",
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
                headers: { 'Authorization': `token ${t}` }
            });

            if (response.ok) {
                const data = await response.json();
                // فك التشفير ودعم اللغة العربية
                const decodedContent = decodeURIComponent(escape(atob(data.content.replace(/\s/g, ''))));
                const remoteDb = JSON.parse(decodedContent);
                
                // البحث عن المستخدم داخل الملف المجلوب
                const userMatch = remoteDb.users.find(user => user.username === u && user.password === p);
                
                if (userMatch) {
                    db = remoteDb; // تحديث قاعدة البيانات المحلية
                    db.sha = data.sha;
                    sessionStorage.setItem('gh_token', t);
                    if(rem) localStorage.setItem('saved_creds', JSON.stringify({u, p, t}));
                    currentUser = userMatch;
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
            const response = await fetch(`https://api.github.com/repos/${CONFIG.REPO_NAME}/contents/${CONFIG.FILE_PATH}`, {
                headers: { 'Authorization': `token ${token}` }
            });
            if (response.ok) {
                const data = await response.json();
               const decodedContent = decodeURIComponent(escape(atob(data.content.replace(/\s/g, ''))));
db = JSON.parse(decodedContent);
                db.sha = data.sha; 
                
                // إذا كان هناك بيانات مخزنة مسبقاً، قم بتحميلها في التطبيق
               if (db.currentStories && db.currentStories.length > 0) {
    // تحويل نصوص التواريخ إلى Objects لضمان عمل الحسابات والـ UI
    db.currentStories.forEach(s => {
        if (s.expectedRelease) {
            s.expectedRelease = new Date(s.expectedRelease);
        }
    });
    this.calculateTimelines(db.currentStories);
}
            
            ui.renderAll();
        } else {
            console.log("File not found, creating new DB...");
            this.saveToGitHub();
        }
    } catch (e) { 
        console.error(e);
        alert("خطأ في المزامنة مع GitHub"); 
    }
},

async saveToGitHub() {
    const token = sessionStorage.getItem('gh_token');
    
    // تحويل البيانات لـ Base64 بشكل يدعم اللغة العربية
    const jsonString = JSON.stringify(db, null, 2);
    const content = btoa(unescape(encodeURIComponent(jsonString)));
    
    try {
        const response = await fetch(`https://api.github.com/repos/${CONFIG.REPO_NAME}/contents/${CONFIG.FILE_PATH}`, {
            method: 'PUT',
            headers: { 
                'Authorization': `token ${token}`, 
                'Content-Type': 'application/json' 
            },
            body: JSON.stringify({
                message: "Update Database",
                content: content,
                sha: db.sha || undefined
            })
        });

        if (response.ok) {
            const result = await response.json();
            // تحديث الـ sha فوراً بعد نجاح الحفظ لمنع تعارض الـ 409
            db.sha = result.content.sha; 
            console.log("تم تحديث الملف بنجاح، SHA الجديد:", db.sha);
        } else if (response.status === 409) {
            alert("حدث تعارض في البيانات! سيتم إعادة تحميل الصفحة لمزامنة أحدث نسخة.");
            location.reload(); 
        }
    } catch (error) {
        console.error("Error saving to GitHub:", error);
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
        const stories = [];
        let currentStory = null;

        rows.forEach(row => {
            if (row['Work Item Type'] === 'User Story') {
                let area = row['Business Area'];
                if (area && area.trim().toLowerCase() === "integration") area = "LDM Integration";
                if (!area || area.trim() === "") {
                    const path = row['Iteration Path'] || "";
                    area = path.includes('\\') ? path.split('\\')[0] : path;
                }

                currentStory = {
                    id: row['ID'],
                    title: row['Title'],
                    state: row['State'],
                    assignedTo: row['Assigned To'] || "Unassigned",
                    tester: row['Assigned To Tester'] || "Unassigned",
                    area: area || "General",
                    priority: parseInt(row['Business Priority']) || 999,
                    expectedRelease: row['Release Expected Date'] ? new Date(row['Release Expected Date']) : null,
                    tasks: [],
                    bugs: [],
                    calc: {}
                };
                stories.push(currentStory);
            } else if (row['Work Item Type'] === 'Task' && currentStory) {
                currentStory.tasks.push(row);
            } else if (row['Work Item Type'] === 'Bug' && currentStory) {
                currentStory.bugs.push(row);
            }
        });

        this.calculateTimelines(stories);
        db.currentStories = stories;
        this.saveToGitHub().then(() => alert("تم تحديث البيانات بناءً على منطق الأولويات الجديد"));
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
        this.renderStats();
        this.renderActiveCards();
        this.renderDelivery();
        this.renderAvailability();
        this.renderSettings();
        this.renderClientRoadmap();
        this.renderWorkload();
    },

  renderStats() {
    // 1. القصص النشطة (ليست في حالة Tested)
    const active = currentData.filter(s => s.state !== 'Tested' && s.state !== 'Closed');
    
    // 2. القصص الجاهزة للتسليم (حالتها Tested ولم يتم تسجيل تسليمها بعد)
    const readyForDelivery = currentData.filter(s => 
    (s.state === 'Tested' || s.state === 'Closed') && 
    !db.deliveryLogs.some(log => log.storyId === s.id)
);
    
    // 3. القصص المتأخرة
    const delayed = active.filter(s => {
        return s.calc.finalEnd instanceof Date && 
               !isNaN(s.calc.finalEnd.getTime()) && 
               new Date() > s.calc.finalEnd;
    });

    const statsHtml = `
        <div class="bg-blue-600 text-white p-4 rounded-xl shadow">
            <div class="text-sm opacity-80">Active Stories</div>
            <div class="text-2xl font-bold">${active.length}</div>
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
            <div class="text-sm opacity-80">Delivered</div>
            <div class="text-2xl font-bold">${db.deliveryLogs.length}</div>
        </div>
    `;
    document.getElementById('stats-cards').innerHTML = statsHtml;

    const today = new Date().toISOString().split('T')[0];
    
    // Safety check for the overdue container
    document.getElementById('overdue-container').innerHTML = delayed.map(s => `
        <div class="p-2 border-b text-sm">
            <span class="font-bold">[${s.area}]</span> ${s.title}
            <div class="text-xs text-red-400">Delayed since: ${s.calc.finalEnd.toLocaleDateString()}</div>
        </div>
    `).join('');

    // Fix for Line 390: Check if date is valid before calling .toISOString()
    document.getElementById('today-container').innerHTML = active.filter(s => {
        return s.calc.finalEnd instanceof Date && 
               !isNaN(s.calc.finalEnd.getTime()) && 
               s.calc.finalEnd.toISOString().split('T')[0] === today;
    }).map(s => `
        <div class="p-2 border-b text-sm">
            <span class="font-bold">[${s.area}]</span> ${s.title} - <span class="text-blue-500">${s.assignedTo}</span>
        </div>
    `).join('') || '<div class="text-gray-400 text-center">Nothing planned for today</div>';
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
    const searchTerm = document.getElementById('search-input')?.value.toLowerCase() || ""; // الحصول على نص البحث
    
    // فلترة القصص النشطة بناءً على حالة البحث
   const activeStories = currentData.filter(s => {
    const isNotFinished = s.state !== 'Tested' && s.state !== 'Closed';
    const matchesSearch = 
        s.title.toLowerCase().includes(searchTerm) || 
        s.id.toString().includes(searchTerm) || 
        s.tester.toLowerCase().includes(searchTerm) ||
        s.assignedTo.toLowerCase().includes(searchTerm) ||
        (s.area && s.area.toLowerCase().includes(searchTerm));
            
    // استخدام isNotFinished بدلاً من isNotTested
    return isNotFinished && matchesSearch; 
});
    
    if (activeStories.length === 0) {
        container.innerHTML = `<div class="col-span-full text-center py-20 text-gray-400">
            ${searchTerm ? 'لا توجد نتائج تطابق بحثك.' : 'No active stories found.'}
        </div>`;
        return;
    }

    // 1. تجميع البيانات حسب Business Area
    const groupedStories = activeStories.reduce((groups, story) => {
        const area = story.area || "General";
        if (!groups[area]) groups[area] = [];
        groups[area].push(story);
        return groups;
    }, {});

    // 2. رندر المجموعات مع الترتيب
    container.innerHTML = Object.keys(groupedStories).map(area => {
        const storiesInArea = groupedStories[area].sort((a, b) => {
            // الترتيب الأول: حسب الأولوية (Priority) - الرقم الأقل يعني أولوية أعلى
            if (a.priority !== b.priority) {
                return a.priority - b.priority;
            }
            
            // الترتيب الثاني: إذا تساوت الأولوية، يتم الترتيب حسب التأخير
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
    
    // --- منطق لمبات الحالة ---
    
    // 1. لمبة التطوير (Development)
    // تنور أحمر إذا: التاريخ الحالي تجاوز موعد الديف و الحالة ليست Resolved وليست Tested
    const isDevLate = s.calc.devEnd instanceof Date && now > s.calc.devEnd && s.state === 'Resolved' || s.state === 'Tested' || s.state === 'Closed';
    const devLightColor = (s.state === 'Resolved' || s.state === 'Tested') ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]' : (isDevLate ? 'bg-red-500 animate-pulse shadow-[0_0_8px_rgba(239,68,68,0.6)]' : 'bg-gray-300');

    // 2. لمبة الجودة (QA)
    // تنور أحمر إذا: التاريخ الحالي تجاوز موعد التست والحالة ليست Tested
    const isTestLate = s.calc.testEnd instanceof Date && now > s.calc.testEnd && s.state === 'Tested' || s.state === 'Closed';
    const testLightColor = (s.state === 'Tested') ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]' : (isTestLate ? 'bg-red-500 animate-pulse shadow-[0_0_8px_rgba(239,68,68,0.6)]' : 'bg-gray-300');

    // 3. لمبة تاريخ التسليم المتوقع (Client Expected Release)
    const isReleaseLate = s.expectedRelease instanceof Date && now > s.expectedRelease && s.state === 'Tested' || s.state === 'Closed';
    const releaseLightColor = (s.state === 'Tested') ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]' : (isReleaseLate ? 'bg-red-500 animate-pulse shadow-[0_0_8px_rgba(239,68,68,0.6)]' : 'bg-gray-300');

    const priorityBadge = `<span class="px-2 py-0.5 rounded bg-gray-100 text-[10px] font-bold text-gray-600">P${s.priority || 999}</span>`;

    let statusColor = "bg-blue-100 text-blue-700";
    if(isLate) statusColor = "bg-red-100 text-red-700";
    if(hasError) statusColor = "bg-amber-100 text-amber-700";

    const statusText = hasError ? 'Action Required' : (isLate ? `Overdue ⚠️ (${s.state})` : s.state);

    // ابحث عن جزء الـ Return داخل renderActiveCards واستبدله بهذا:
return `
    <div class="bg-white rounded-2xl shadow-sm border border-gray-100 hover:shadow-md transition-shadow overflow-hidden flex flex-col">
        <div class="p-5 flex-1">
            <div class="flex justify-between items-start mb-4">
                <div class="flex gap-2">
                    <span class="px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider ${statusColor}">
                        ${statusText}
                    </span>
                    ${priorityBadge}
                </div>
                <span class="text-xs font-mono text-gray-400">#${s.id}</span>
            </div>
                            
            <h3 class="text-lg font-bold text-slate-800 mb-1 leading-tight">${s.title}</h3>

            <div class="grid grid-cols-2 gap-4 py-4 border-t border-gray-50 mt-4">
                <div class="relative">
                    <div class="flex items-center gap-2 mb-1">
                        <div class="w-2.5 h-2.5 rounded-full ${devLightColor}" title="Dev Status"></div>
                        <p class="text-[10px] uppercase text-gray-400 font-bold">Development</p>
                    </div>
                    <div class="flex flex-col gap-0.5">
                        <p class="text-sm font-medium text-slate-700 flex items-center gap-2">
                            <span class="w-6 h-6 rounded-full bg-slate-100 flex items-center justify-center text-[10px]">🛠</span>
                            ${s.assignedTo}
                        </p>
                        <p class="text-[10px] text-gray-500 ml-8">
                            Ends: ${s.calc.devEnd instanceof Date ? s.calc.devEnd.toLocaleString('en-GB', {day:'numeric', month:'short', hour:'2-digit', minute:'2-digit'}) : 'TBD'}
                        </p>
                    </div>
                </div>

                <div class="relative">
                    <div class="flex items-center gap-2 mb-1">
                        <div class="w-2.5 h-2.5 rounded-full ${testLightColor}" title="QA Status"></div>
                        <p class="text-[10px] uppercase text-gray-400 font-bold">Quality Assurance</p>
                    </div>
                    <div class="flex flex-col gap-0.5">
                        <p class="text-sm font-medium text-slate-700 flex items-center gap-2">
                            <span class="w-6 h-6 rounded-full bg-slate-100 flex items-center justify-center text-[10px]">🔍</span>
                            ${s.tester}
                        </p>
                        <p class="text-[10px] text-gray-500 ml-8">
                            Ends: ${s.calc.testEnd instanceof Date ? s.calc.testEnd.toLocaleString('en-GB', {day:'numeric', month:'short', hour:'2-digit', minute:'2-digit'}) : 'Waiting'}
                        </p>
                    </div>
                </div>

                <div class="col-span-2 mt-2 pt-2 border-t border-dashed border-gray-100">
                    <div class="flex items-center justify-between">
                        <div class="flex items-center gap-2">
                            <div class="w-2.5 h-2.5 rounded-full ${releaseLightColor}" title="Client Release Status"></div>
                            <p class="text-[10px] uppercase text-gray-400 font-bold">Client Expected Date</p>
                        </div>
                        <p class="text-xs font-bold ${isReleaseLate ? 'text-red-600' : 'text-slate-600'}">
                            ${s.expectedRelease instanceof Date ? s.expectedRelease.toLocaleDateString('en-GB') : 'Not Set'}
                        </p>
                    </div>
                </div>
            </div>
        </div>

        <div class="${isLate ? 'bg-red-50' : 'bg-slate-50'} p-4 flex justify-between items-center border-t border-gray-100">
            <div class="flex flex-col">
                <span class="text-[10px] uppercase font-bold text-gray-400">Final Delivery (Internal)</span>
                <span class="text-sm font-bold ${isLate ? 'text-red-600' : 'text-slate-700'}">
                    ${s.calc.finalEnd instanceof Date ? s.calc.finalEnd.toLocaleString('en-GB', {day:'numeric', month:'short', hour:'2-digit', minute:'2-digit'}) : 'Waiting for Data'}
                </span>
            </div>
            ${isLate || isReleaseLate ? '<span class="text-xl animate-bounce">⚠️</span>' : '<span class="text-xl">🗓️</span>'}
        </div>
    </div>
    `;
}).join('')}
        `;
    }).join('');
}
    ,

renderDelivery() {
    const container = document.getElementById('delivery-grid');
    
    // 1. جلب كل الستوريز التي حالتها المختبرة
    const allTested = currentData.filter(s => s.state === 'Tested' || s.state === 'Closed');

    if (allTested.length === 0 && db.deliveryLogs.length === 0) {
        container.innerHTML = `<div class="col-span-full text-center py-10 text-gray-400">لا توجد عناصر جاهزة للتسليم حالياً.</div>`;
        return;
    }

    // 2. الفلترة الصحيحة:
    // "بانتظار التسليم": هي التي حالتها Tested ولكن لم يتم تسجيلها في الـ Logs
    const pendingStories = allTested.filter(s => !db.deliveryLogs.some(l => l.storyId === s.id.toString()));
    
    // "تم التسليم": هي الستوريز الموجودة في الـ Logs
    // نقوم بمطابقة بيانات الـ Log مع بيانات الستوري الأصلية لعرض الاسم والتفاصيل
    const completedStories = db.deliveryLogs.map(log => {
        const story = currentData.find(s => s.id.toString() === log.storyId.toString());
        return { 
            ...story, 
            logData: log,
            // إذا لم يتم العثور على الستوري في ملف الـ CSV الحالي (تم حذفها مثلاً)، نعرض بيانات اللوج فقط
            title: story ? story.title : "Story not in current CSV",
            area: story ? story.area : "N/A"
        };
    }).reverse(); // لعرض الأحدث أولاً

    // وظيفة مساعدة لإنشاء HTML لكل كارت
    const createCardHtml = (s, isLogged) => {
        return `
            <div class="bg-white p-4 rounded-xl border-2 transition-all ${isLogged ? 'border-gray-100 opacity-60 shadow-none' : 'border-blue-200 shadow-sm hover:border-blue-400'}">
                <div class="flex justify-between items-start mb-2">
                    <span class="text-[10px] font-mono text-gray-400">#${isLogged ? s.logData.storyId : s.id}</span>
                    <span class="text-xs font-bold ${isLogged ? 'text-green-500' : 'text-blue-500 italic'}">
                        ${isLogged ? '✓ تم التسليم' : 'بانتظار التسليم'}
                    </span>
                </div>
                <div class="font-bold text-slate-800 mb-4 leading-snug">${s.title}</div>
                <div class="text-[10px] text-gray-500 mb-2 italic">Area: ${s.area || "General"}</div>
                
// داخل دالة renderDelivery - ابحث عن السطر الذي يبدأ بـ ${isLogged ? `
${isLogged ? `
                    <div class="text-xs bg-green-50 text-green-700 p-2 rounded-lg border border-green-100">
                        <b>المستلم:</b> ${s.logData.to}<br>
                        <b>التاريخ:</b> ${s.logData.date}
                    </div>
                ` : (currentUser.role === 'admin' ? `
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
        ${pendingStories.map(s => createCardHtml(s, false)).join('') || '<div class="col-span-full text-center text-gray-400 py-4">لا يوجد مهام بانتظار التسليم</div>'}

        <div class="col-span-full my-8 border-t-2 border-dashed border-gray-200"></div>

        <div class="col-span-full mb-4">
            <h3 class="text-lg font-bold text-gray-500 flex items-center gap-2">
                ✅ تم التسليم مؤخراً (${completedStories.length})
            </h3>
        </div>
        ${completedStories.map(s => createCardHtml(s, true)).join('') || '<div class="col-span-full text-center text-gray-400 py-4">لم يتم تسليم أي عناصر بعد</div>'}
    `;

    container.innerHTML = html;
},

    markDelivered(id) {
        const to = document.getElementById(`to-${id}`).value;
        if(!to) return alert("اكتب المستلم");
        db.deliveryLogs.push({
            storyId: id, to, date: new Date().toLocaleDateString(), timestamp: Date.now()
        });
        dataProcessor.saveToGitHub();
        this.renderDelivery();
    },

  renderAvailability() {
    const container = document.getElementById('availability-container');
    
    // 1. استخراج كل المناطق (Areas) الفريدة
    const areas = [...new Set(currentData.map(s => s.area || "General"))];
    
    let html = '';

    areas.forEach(area => {
        // جميع القصص في هذه المنطقة
        const allAreaStories = currentData.filter(s => s.area === area);
        
        // استخراج قائمة الموظفين (الديف فقط)
        const staffInArea = {
            developers: [...new Set(allAreaStories.map(s => s.assignedTo))]
            // تم حذف التستر من هنا
        };

        html += `
            <div class="col-span-full mt-6">
                <h2 class="text-xl font-bold text-indigo-800 border-b-2 border-indigo-100 pb-2 mb-4 flex items-center gap-2">
                    📍 Area: ${area}
                </h2>
            </div>
        `;

        const getSortedStaff = (staffList, roleType) => {
            return staffList.map(person => {
                const activeTasks = allAreaStories.filter(s => {
                    const isUserTask = (roleType === 'dev' ? s.assignedTo === person : s.tester === person);
                    const isActive = !['Resolved', 'Tested', 'Closed', 'On-Hold'].includes(s.state);
                    return isUserTask && isActive;
                });
                
                let lastDate = null;
                if (activeTasks.length > 0) {
                    const sortedTasks = activeTasks.sort((a, b) => {
                        const getDate = (story) => {
                            // الحساب يعتمد على devEnd لأننا نهتم بجاهزية المطور
                            return story.calc.devEnd instanceof Date ? story.calc.devEnd : new Date(0);
                        };
                        return getDate(b) - getDate(a);
                    });
                    
                    const topStory = sortedTasks[0];
                    lastDate = topStory.calc.devEnd;
                }

                return { 
                    name: person, 
                    freeDate: lastDate instanceof Date ? lastDate : null 
                };
            }).sort((a, b) => {
                if (a.freeDate === null && b.freeDate !== null) return -1;
                if (a.freeDate !== null && b.freeDate === null) return 1;
                return a.freeDate - b.freeDate;
            });
        };

        const sortedDevs = getSortedStaff(staffInArea.developers, 'dev');

        // عرض الديف فقط وحذف الجزء الخاص بالـ Testers
        if (sortedDevs.length > 0) {
            html += `<div class="col-span-full mb-2 mt-2 font-bold text-blue-600 text-sm uppercase tracking-widest">Developers</div>`;
            html += sortedDevs.map(dev => this.generateStaffCard(dev, "🛠", 'dev')).join('');
        }
    });

    container.innerHTML = html || '<div class="col-span-full text-center text-gray-400">No staff found.</div>';
},

// تحديث دالة الكارت لضمان ظهور اللون الأخضر بوضوح للمتاحين
// تحديث الدالة لتقبل المعطى الثالث role
generateStaffCard(person, icon, role) {
    const isFree = person.freeDate === null;
    const dateString = isFree ? "متاح الآن" : person.freeDate.toLocaleString('en-GB', {day:'numeric', month:'short', hour:'2-digit', minute:'2-digit'});
    
    // الألوان الافتراضية بناءً على الدور (تظهر في حالة الانشغال)
    let roleClasses = role === 'dev' 
        ? "border-blue-500 bg-blue-50/50" // لون خلفية زرقاء خفيفة للمطورين
        : "border-purple-500 bg-purple-50/50"; // لون خلفية بنفسجية خفيفة للتستر

    // إذا كان الموظف متاحاً، نعطيه اللون الأخضر المميز بغض النظر عن دوره
    const statusClasses = isFree 
        ? "border-green-500 bg-green-50 shadow-[0_0_10px_rgba(34,197,94,0.1)]" 
        : roleClasses;
    
    const textClasses = isFree ? "text-green-700 font-bold" : "text-slate-600";
    const iconCircle = isFree ? "bg-green-100" : (role === 'dev' ? "bg-blue-100" : "bg-purple-100");

    return `
        <div class="p-4 rounded-xl shadow-sm border-l-4 ${statusClasses} flex flex-col justify-center transition-all">
            <div class="flex items-center gap-2 mb-1">
                <span class="w-8 h-8 rounded-full ${iconCircle} flex items-center justify-center text-lg">${icon}</span>
                <span class="font-bold text-slate-800">${person.name}</span>
            </div>
            <div class="text-sm ${textClasses} mt-2 flex items-center gap-1">
                ${isFree ? '<span class="flex h-2 w-2 rounded-full bg-green-500 animate-pulse"></span>' : '📅 '}
                ${dateString}
            </div>
        </div>
    `;
},

renderWorkload() {
    const container = document.getElementById('workload-container');
    if (!container) return;

    // 1. فلترة القصص النشطة فقط
    const activeStories = currentData.filter(s => s.state !== 'Tested' && s.state !== 'Closed');

    // 2. تجميع البيانات حسب Area -> Role -> Staff
    const areaWorkload = {};
    const MAX_HOURS = 50;

    activeStories.forEach(s => {
        const area = s.area || "General";
        if (!areaWorkload[area]) {
            areaWorkload[area] = { devs: {}, testers: {} };
        }

        // حساب ساعات التطوير
        const devHours = s.tasks
            .filter(t => ["Development", "DB Modification"].includes(t['Activity']))
            .reduce((acc, t) => acc + parseFloat(t['Original Estimation'] || 0), 0);

        // حساب ساعات الاختبار
        const testHours = s.tasks
            .filter(t => t['Activity'] === 'Testing' || t['Activity'] === 'Preparation')
            .reduce((acc, t) => acc + parseFloat(t['Original Estimation'] || 0), 0);

        // إضافة للمطور
        if (s.assignedTo && s.assignedTo !== "Unassigned") {
            if (!areaWorkload[area].devs[s.assignedTo]) areaWorkload[area].devs[s.assignedTo] = { hours: 0, items: [] };
            areaWorkload[area].devs[s.assignedTo].hours += devHours;
            areaWorkload[area].devs[s.assignedTo].items.push(s);
        }

        // إضافة للمختبر
        if (s.tester && s.tester !== "Unassigned") {
            if (!areaWorkload[area].testers[s.tester]) areaWorkload[area].testers[s.tester] = { hours: 0, items: [] };
            areaWorkload[area].testers[s.tester].hours += testHours;
            areaWorkload[area].testers[s.tester].items.push(s);
        }
    });

    // 3. دالة فرعية لإنشاء بلوك الموظف (Progress Bar)
    const generateStaffProgress = (staff, data, color) => {
        const totalHours = data.hours;
        const percentage = Math.min((totalHours / MAX_HOURS) * 100, 100);
        const isOverloaded = totalHours > MAX_HOURS;
        const barColor = isOverloaded ? 'bg-red-500' : `bg-${color}-500`;
        const textColor = isOverloaded ? 'text-red-600 bg-red-50' : `text-${color}-600 bg-${color}-50`;

        return `
            <div class="mb-4">
                <div class="flex justify-between items-center mb-1">
                    <span class="text-sm font-semibold text-slate-700">${staff}</span>
                    <span class="text-[11px] font-bold ${textColor} px-2 py-0.5 rounded">
                        ${totalHours.toFixed(1)} / ${MAX_HOURS}h
                    </span>
                </div>
                <div class="w-full bg-gray-100 h-2 rounded-full overflow-hidden">
                    <div class="${barColor} h-full transition-all duration-500" style="width: ${percentage}%"></div>
                </div>
                <div class="mt-1 flex flex-wrap gap-1">
                    ${data.items.map(s => `<span class="text-[8px] px-1 bg-white border border-gray-100 text-gray-400 rounded">#${s.id}</span>`).join('')}
                </div>
            </div>
        `;
    };

    // 4. بناء الـ HTML النهائي
    let finalHtml = '';
    const sortedAreas = Object.keys(areaWorkload).sort();

    sortedAreas.forEach(area => {
        const devs = areaWorkload[area].devs;
        const testers = areaWorkload[area].testers;

        finalHtml += `
            <div class="col-span-full mb-8">
                <h2 class="text-xl font-bold text-indigo-900 mb-4 flex items-center gap-2">
                    <span class="p-1.5 bg-indigo-100 rounded-lg text-indigo-600">📂</span>
                    Area: ${area}
                </h2>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div class="bg-white p-4 rounded-xl shadow-sm border border-slate-100">
                        <h4 class="text-xs font-bold text-blue-500 uppercase tracking-widest mb-4 flex items-center gap-2">
                            <span class="w-2 h-2 rounded-full bg-blue-500"></span> Developers
                        </h4>
                        ${Object.keys(devs).map(name => generateStaffProgress(name, devs[name], 'blue')).join('') || '<p class="text-xs text-gray-400">No active dev tasks</p>'}
                    </div>
                    
                    <div class="bg-white p-4 rounded-xl shadow-sm border border-slate-100">
                        <h4 class="text-xs font-bold text-purple-500 uppercase tracking-widest mb-4 flex items-center gap-2">
                            <span class="w-2 h-2 rounded-full bg-purple-500"></span> QA Testers
                        </h4>
                        ${Object.keys(testers).map(name => generateStaffProgress(name, testers[name], 'purple')).join('') || '<p class="text-xs text-gray-400">No active test tasks</p>'}
                    </div>
                </div>
            </div>
        `;
    });

    container.innerHTML = finalHtml || '<div class="col-span-full text-center py-20 text-gray-400">No workload data available.</div>';
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
