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
    handleLogin() {
        const u = document.getElementById('username').value;
        const p = document.getElementById('password').value;
        const t = document.getElementById('gh-token').value;
        const rem = document.getElementById('remember-me').checked;

        if(!u || !p || !t) return alert("برجاء ملء جميع البيانات");

        sessionStorage.setItem('gh_token', t);
        if(rem) localStorage.setItem('saved_creds', JSON.stringify({u, p, t}));

        currentUser = { username: u, role: 'admin' };
        this.startApp();
    },

startApp() {
    document.getElementById('login-screen').classList.add('hidden');
    document.getElementById('app-container').classList.remove('hidden');
    
    // أضف هذا السطر لفتح صفحة Current Status تلقائياً
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
    },

  renderStats() {
    // 1. القصص النشطة (ليست في حالة Tested)
    const active = currentData.filter(s => s.state !== 'Tested');
    
    // 2. القصص الجاهزة للتسليم (حالتها Tested ولم يتم تسجيل تسليمها بعد)
    const readyForDelivery = currentData.filter(s => 
        s.state === 'Tested' && 
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
renderActiveCards() {
    const container = document.getElementById('active-cards-container');
    const searchTerm = document.getElementById('search-input')?.value.toLowerCase() || ""; // الحصول على نص البحث
    
    // فلترة القصص النشطة بناءً على حالة البحث
    const activeStories = currentData.filter(s => {
        const isNotTested = s.state !== 'Tested';
        const matchesSearch = 
            s.title.toLowerCase().includes(searchTerm) || 
            s.id.toString().includes(searchTerm) || 
            s.assignedTo.toLowerCase().includes(searchTerm) || 
            s.tester.toLowerCase().includes(searchTerm) ||
            (s.area && s.area.toLowerCase().includes(searchTerm));
            
        return isNotTested && matchesSearch;
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
    const isDevLate = s.calc.devEnd instanceof Date && now > s.calc.devEnd && s.state !== 'Resolved' && s.state !== 'Tested';
    const devLightColor = (s.state === 'Resolved' || s.state === 'Tested') ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]' : (isDevLate ? 'bg-red-500 animate-pulse shadow-[0_0_8px_rgba(239,68,68,0.6)]' : 'bg-gray-300');

    // 2. لمبة الجودة (QA)
    // تنور أحمر إذا: التاريخ الحالي تجاوز موعد التست والحالة ليست Tested
    const isTestLate = s.calc.testEnd instanceof Date && now > s.calc.testEnd && s.state !== 'Tested';
    const testLightColor = (s.state === 'Tested') ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]' : (isTestLate ? 'bg-red-500 animate-pulse shadow-[0_0_8px_rgba(239,68,68,0.6)]' : 'bg-gray-300');

    const priorityBadge = `<span class="px-2 py-0.5 rounded bg-gray-100 text-[10px] font-bold text-gray-600">P${s.priority || 999}</span>`;

    let statusColor = "bg-blue-100 text-blue-700";
    if(isLate) statusColor = "bg-red-100 text-red-700";
    if(hasError) statusColor = "bg-amber-100 text-amber-700";

    const statusText = hasError ? 'Action Required' : (isLate ? `Overdue ⚠️ (${s.state})` : s.state);

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
                            <div class="w-2.5 h-2.5 rounded-full ${devLightColor}" title="Dev Status Indicator"></div>
                            <p class="text-[10px] uppercase text-gray-400 font-bold">Development</p>
                        </div>
                        <p class="text-sm font-medium text-slate-700 flex items-center gap-2">
                            <span class="w-6 h-6 rounded-full bg-slate-100 flex items-center justify-center text-[10px]">🛠</span>
                            ${s.assignedTo}
                        </p>
                        <p class="text-[10px] text-gray-500 mt-1 italic">
                            Ends: ${hasError ? 'Pending' : (s.calc.devEnd instanceof Date ? s.calc.devEnd.toLocaleDateString('en-GB') : s.calc.devEnd)}
                        </p>
                    </div>

                    <div class="relative">
                        <div class="flex items-center gap-2 mb-1">
                            <div class="w-2.5 h-2.5 rounded-full ${testLightColor}" title="QA Status Indicator"></div>
                            <p class="text-[10px] uppercase text-gray-400 font-bold">Quality Assurance</p>
                        </div>
                        <p class="text-sm font-medium text-slate-700 flex items-center gap-2">
                            <span class="w-6 h-6 rounded-full bg-slate-100 flex items-center justify-center text-[10px]">🔍</span>
                            ${s.tester}
                        </p>
                        <p class="text-[10px] text-gray-500 mt-1 italic">
                            Ends: ${s.calc.testEnd instanceof Date ? s.calc.testEnd.toLocaleDateString('en-GB') : 'TBD'}
                        </p>
                    </div>
                </div>
            </div>

            <div class="${isLate ? 'bg-red-50' : 'bg-slate-50'} p-4 flex justify-between items-center border-t border-gray-100">
                <div class="flex flex-col">
                    <span class="text-[10px] uppercase font-bold text-gray-400">Final Delivery</span>
                    <span class="text-sm font-bold ${isLate ? 'text-red-600' : 'text-slate-700'}">
                        ${s.calc.finalEnd instanceof Date ? s.calc.finalEnd.toLocaleString('en-GB', {day:'numeric', month:'short', hour:'2-digit', minute:'2-digit'}) : 'Waiting for Data'}
                    </span>
                </div>
                ${isLate ? '<span class="text-xl">⚠️</span>' : '<span class="text-xl">🗓️</span>'}
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
    const allTested = currentData.filter(s => s.state === 'Tested');

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
                
                ${isLogged ? `
                    <div class="text-xs bg-green-50 text-green-700 p-2 rounded-lg border border-green-100">
                        <b>المستلم:</b> ${s.logData.to}<br>
                        <b>التاريخ:</b> ${s.logData.date}
                    </div>
                ` : `
                    <div class="flex gap-2 mt-auto">
                        <input id="to-${s.id}" placeholder="اسم المستلم..." class="text-xs border border-gray-200 p-2 rounded-lg flex-1 focus:ring-1 focus:ring-blue-500 outline-none">
                        <button onclick="ui.markDelivered('${s.id}')" class="bg-blue-600 hover:bg-blue-700 text-white px-3 py-2 rounded-lg text-xs font-bold transition-colors">
                            تأكيد
                        </button>
                    </div>
                `}
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
            const areaStories = currentData.filter(s => s.area === area && s.state !== 'Tested');
            
            // 2. استخراج المطورين فقط وتجاهل الـ Unassigned
            const rawDevelopers = [...new Set(areaStories.map(s => s.assignedTo))];
            const developersOnly = rawDevelopers.filter(name => name && name.toLowerCase() !== "unassigned");

            if (developersOnly.length === 0) return; // تخطي المنطقة إذا لم يوجد بها مطورين

            html += `
                <div class="col-span-full mt-6">
                    <h2 class="text-xl font-bold text-indigo-800 border-b-2 border-indigo-100 pb-2 mb-4 flex items-center gap-2">
                        📍 Area: ${area}
                    </h2>
                </div>
            `;

            // وظيفة فرعية لحساب التاريخ المتاح وترتيب الأشخاص (للمطورين فقط)
            const getSortedStaff = (staffList) => {
                return staffList.map(person => {
                    const tasks = areaStories.filter(s => s.assignedTo === person);
                    
                    const sortedTasks = tasks.sort((a, b) => {
                        const dateA = a.calc.finalEnd instanceof Date ? a.calc.finalEnd : new Date(0);
                        const dateB = b.calc.finalEnd instanceof Date ? b.calc.finalEnd : new Date(0);
                        return dateB - dateA;
                    });

                    const lastDate = (sortedTasks.length > 0 && sortedTasks[0].calc.finalEnd instanceof Date) 
                        ? sortedTasks[0].calc.finalEnd 
                        : null;

                    return { name: person, freeDate: lastDate };
                }).sort((a, b) => {
                    if (a.freeDate === null) return -1;
                    if (b.freeDate === null) return 1;
                    return a.freeDate - b.freeDate;
                });
            };

            const sortedDevs = getSortedStaff(developersOnly);

            // 3. رندر المطورين فقط
            if (sortedDevs.length > 0) {
                html += `<div class="col-span-full mb-2 mt-2 font-bold text-slate-500 text-sm uppercase tracking-widest">Developers</div>`;
                html += sortedDevs.map(dev => this.generateStaffCard(dev, "🛠")).join('');
            }
            
            // تم حذف كود رندر الـ Testers من هنا
        });

        container.innerHTML = html || '<div class="col-span-full text-center text-gray-400">No Developers found.</div>';
    },

    // وظيفة مساعدة لإنشاء الكارت (Card) لتقليل تكرار الكود
    generateStaffCard(person, icon) {
        const isFree = person.freeDate === null;
        const dateString = isFree ? "متاح الآن" : person.freeDate.toLocaleString('en-GB', {day:'numeric', month:'short', hour:'2-digit', minute:'2-digit'});
        const statusColor = isFree ? "border-green-500 bg-green-50" : "border-indigo-500 bg-white";

        return `
            <div class="p-4 rounded-xl shadow-sm border-l-4 ${statusColor} flex flex-col justify-center">
                <div class="flex items-center gap-2 mb-1">
                    <span class="text-lg">${icon}</span>
                    <span class="font-bold text-slate-800">${person.name}</span>
                </div>
                <div class="text-sm ${isFree ? 'text-green-700 font-bold' : 'text-indigo-600'}">
                    ${isFree ? '● ' : '📅 '}${dateString}
                </div>
            </div>
        `;
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
    }
};

/**
 * Settings Management
 */
const settings = {
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
