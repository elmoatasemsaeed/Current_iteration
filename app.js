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
                const binaryString = atob(data.content.replace(/\s/g, ''));
const bytes = new Uint8Array(binaryString.length);
for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
}
const decodedContent = new TextDecoder("utf-8").decode(bytes);
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
            if (s.changedDate) s.changedDate = new Date(s.changedDate);
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
                    tags: row['Tags'] ? row['Tags'].split(';').filter(t => t.trim() !== "") : [],
                    expectedRelease: row['Release Expected Date'] ? new Date(row['Release Expected Date']) : null,
                    branch: row['Branch'] || "N/A",           // تعريف عمود Branch
                    customer: row['Customer'] || "General",   // تعريف عمود Customer
                    changedDate: row['Changed Date'] ? new Date(row['Changed Date']) : null, // تعريف Changed Date
                    tasks: [],
                    bugs: [],
                    testCases: [],
                    calc: {}
                };
                stories.push(currentStory);
            } else if (row['Work Item Type'] === 'Task' && currentStory) {
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
        this.renderStats();
        this.renderActiveCards();
        this.renderDelivery();
        this.renderSettings();
        this.renderClientRoadmap();
        this.renderWorkload();

        if (currentUser && currentUser.role === 'viewer') {
            const uploadBtn = document.querySelector("button[onclick*='csv-input']");
            if (uploadBtn) uploadBtn.style.display = 'none';
            
            const settingsNav = document.querySelector("button[onclick*='settings']");
            if (settingsNav) settingsNav.style.display = 'none';
        }

        const activeTab = document.querySelector('.tab-content.active');
        if (activeTab && activeTab.id === 'tab-daily-activity') {
            this.renderDailyActivity();
        }
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
    const searchTerm = document.getElementById('search-input')?.value.toLowerCase() || ""; 
    
    const activeStories = currentData.filter(s => {
        const isNotFinished = s.state !== 'Tested' && s.state !== 'Closed';
        const matchesSearch = 
            s.title.toLowerCase().includes(searchTerm) || 
            s.id.toString().includes(searchTerm) || 
            s.tester.toLowerCase().includes(searchTerm) ||
            s.assignedTo.toLowerCase().includes(searchTerm) ||
            (s.area && s.area.toLowerCase().includes(searchTerm));
            
        return isNotFinished && matchesSearch; 
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
                
                // --- حسابات الـ Dev & Estimation ---
                const devTasks = s.tasks.filter(t => ["Development", "DB Modification"].includes(t['Activity']));
                const totalDevEffort = devTasks.reduce((acc, t) => acc + parseFloat(t['Original Estimation'] || 0), 0);
                let devStartDisplay = "TBD";
                const devActivatedDates = devTasks.map(t => t['Activated Date']).filter(d => d).sort();
                
                // حساب إجازات الديف (من البداية حتى اليوم)
                const devVacDaysNow = devActivatedDates.length > 0 
                    ? dateEngine.countVacationDaysUntilNow(devActivatedDates[0], s.assignedTo) 
                    : 0;

                if (devActivatedDates.length > 0) {
                    devStartDisplay = new Date(devActivatedDates[0]).toLocaleDateString('en-GB');
                }
               
                let devResolveDate = "N/A";
                const resolvedDevTasks = devTasks.filter(t => ['Closed', 'Resolved', 'To Be Reviewed'].includes(t['State']) && t['Changed Date']);
                if (resolvedDevTasks.length > 0) {
                    const latestTask = resolvedDevTasks.sort((a, b) => new Date(b['Changed Date']) - new Date(a['Changed Date']))[0];
                    devResolveDate = new Date(latestTask['Changed Date']).toLocaleDateString('en-GB');
                }

                // --- حسابات الـ Tester & Estimation ---
                const testTasks = s.tasks.filter(t => t['Activity'] === 'Testing');
                const totalTestEffort = testTasks.reduce((acc, t) => acc + parseFloat(t['Original Estimation'] || 0), 0);
                let testStartDisplay = "Waiting";
                const execTask = s.tasks.find(t => t['Title'] && t['Title'].toLowerCase().includes('execution'));
                
                // حساب إجازات التستر (من البداية حتى اليوم)
                const testVacDaysNow = (execTask && execTask['Activated Date']) 
                    ? dateEngine.countVacationDaysUntilNow(execTask['Activated Date'], s.tester) 
                    : 0;

                if (execTask && execTask['Activated Date']) {
                    testStartDisplay = new Date(execTask['Activated Date']).toLocaleDateString('en-GB');
                }

                // --- لمبات الحالة ---
                const isDevLate = s.calc.devEnd instanceof Date && now > s.calc.devEnd && (s.state !== 'Resolved' && s.state !== 'Tested' && s.state !== 'Closed');
                const devLightColor = (s.state === 'Resolved' || s.state === 'Tested' || s.state === 'Closed') ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]' : (isDevLate ? 'bg-red-500 animate-pulse shadow-[0_0_8px_rgba(239,68,68,0.6)]' : 'bg-gray-300');

                const isTestLate = s.calc.testEnd instanceof Date && now > s.calc.testEnd && (s.state !== 'Tested' && s.state !== 'Closed');
                const testLightColor = (s.state === 'Tested' || s.state === 'Closed') ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]' : (isTestLate ? 'bg-red-500 animate-pulse shadow-[0_0_8px_rgba(239,68,68,0.6)]' : 'bg-gray-300');

                // --- عدادات البروجريس بار ---
                const nonTestTasks = s.tasks.filter(t => t['Activity'] !== 'Testing' && t['Activity'] !== 'Preparation');
                const totalDevTasks = nonTestTasks.length;
                const completedDevTasks = nonTestTasks.filter(t => ['Closed', 'To Be Reviewed'].includes(t['State'])).length;
                const devProgressPercent = totalDevTasks > 0 ? Math.round((completedDevTasks / totalDevTasks) * 100) : 0;

                const totalBugs = s.bugs ? s.bugs.length : 0;
                const completedBugs = s.bugs ? s.bugs.filter(b => ['Closed', 'Resolved'].includes(b['State'])).length : 0;
                const fixingProgressPercent = totalBugs > 0 ? Math.round((completedBugs / totalBugs) * 100) : 0;

                const testCases = s.testCases || [];
                const totalTC = testCases.length;
                const completedTC = testCases.filter(tc => ['Pass', 'Fail', 'Not Applicable'].includes(tc.state)).length;
                const progressPercent = totalTC > 0 ? Math.round((completedTC / totalTC) * 100) : 0;

                let statusColor = isLate ? "bg-red-100 text-red-700" : (hasError ? "bg-amber-100 text-amber-700" : "bg-blue-100 text-blue-700");
                const statusText = hasError ? 'Action Required' : (isLate ? `Overdue ⚠️ (${s.state})` : s.state);

                return `
                <div onclick="ui.openStoryModal('${s.id}')" class="cursor-pointer bg-white rounded-2xl shadow-sm border border-gray-100 hover:shadow-md hover:border-indigo-200 transition-all overflow-hidden flex flex-col mb-4">
                    <div class="p-5 flex-1">
                        <div class="flex justify-between items-start mb-4">
                            <div class="flex gap-2">
                                <span class="px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider ${statusColor}">${statusText}</span>
                                <span class="px-2 py-0.5 rounded bg-gray-100 text-[10px] font-bold text-gray-600">P${s.priority || 999}</span>
                            </div>
                            <span class="text-xs font-mono text-gray-400">#${s.id}</span>
                       
                        </div>

                         <div class="flex flex-wrap gap-1 mt-2">
    ${s.tags.map(t => `<span class="px-2 py-0.5 bg-red-50 text-red-700 border border-red-200 rounded text-[10px] font-semibold">${t}</span>`).join('')}
</div>
                                        
                        <h3 class="text-lg font-bold text-slate-800 mb-1 leading-tight">${s.title}</h3>

                        <div class="grid grid-cols-2 gap-4 py-4 border-t border-gray-50 mt-4">
                            <div>
                                <div class="flex items-center gap-2 mb-1">
                                    <div class="w-2.5 h-2.5 rounded-full ${devLightColor}"></div>
                                    <p class="text-[10px] uppercase text-gray-400 font-bold">Development</p>
                                </div>
                                <div class="flex flex-col gap-0.5">
                                    <p class="text-sm font-medium text-slate-700 flex items-center gap-2">
                                        <span class="w-6 h-6 rounded-full bg-slate-100 flex items-center justify-center text-[10px]">🛠</span>
                                        ${s.assignedTo}
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
                                    <p class="text-[10px] uppercase text-gray-400 font-bold">Quality Assurance</p>
                                </div>
                                <div class="flex flex-col gap-0.5">
                                    <p class="text-sm font-medium text-slate-700 flex items-center gap-2">
                                        <span class="w-6 h-6 rounded-full bg-slate-100 flex items-center justify-center text-[10px]">🔍</span>
                                        ${s.tester}
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
                <span class="text-xs font-bold ${isLogged ? 'text-green-500' : 'text-blue-500 italic'}">
                    ${isLogged ? '✓ تم التسليم' : 'بانتظار التسليم'}
                </span>
            </div>
            <div class="font-bold text-slate-800 mb-4 leading-snug">${s.title}</div>
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
