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
            // --- استعادة الكود من نسخة app (23).js ---
            let area = row['Business Area'];
            if (area && area.trim().toLowerCase() === "integration") {
                area = "LDM Integration";
            }
            if (!area || area.trim() === "") {
                const path = row['Iteration Path'] || "";
                area = path.includes('\\') ? path.split('\\')[0] : path;
            }
            // ------------------------------------------

            currentStory = {
                id: row['ID'],
                title: row['Title'],
                state: row['State'],
                assignedTo: row['Assigned To'] || "Unassigned",
                tester: row['Assigned To Tester'] || "Unassigned",
                area: area || "General", // الآن لن يظهر خطأ
                priority: parseInt(row['Business Priority']) || 999,
                expectedDate: row['Release Expected Date'],
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

        // 1. حساب التواريخ أولاً
        this.calculateTimelines(stories);

        // 2. تحديث الـ DB بالبيانات الجديدة (تمسح القديم وتضع الجديد)
        // ملاحظة: deliveryLogs و vacations و holidays لن تتاثر لأننا نحدث مفتاح stories فقط
        db.currentStories = stories;

        // 3. حفظ النسخة الجديدة كاملة على جيت هب
        this.saveToGitHub().then(() => {
            alert("تم تحديث البيانات وحفظها بنجاح على GitHub");
        });
    },


    calculateTimelines(stories) {
        stories.sort((a, b) => a.id - b.id);
        const testerAvailability = {};

        stories.forEach(story => {
            // 1. حساب تطوير القصة
            const devTasks = story.tasks.filter(t => ["Development", "DB Modification"].includes(t['Activity']));
            const devHours = devTasks.reduce((acc, t) => acc + parseFloat(t['Original Estimation'] || 0), 0);
            
            let devStart = null;
            const activatedDates = devTasks.map(t => t['Activated Date']).filter(d => d).sort();
            if (activatedDates.length > 0) devStart = new Date(activatedDates[0]);

            if (!devStart) {
                story.calc.error = "لم يتم بدء العمل (No Activated Tasks)";
                story.calc.devEnd = "بانتظار البدء";
                story.calc.testEnd = "---";
                story.calc.finalEnd = "---";
                return; 
            }

            story.calc.devEnd = dateEngine.addWorkingHours(devStart, devHours, story.assignedTo);

            // 2. حساب الاختبار (Testing) مع فحص الإجازات
            const testTasks = story.tasks.filter(t => t['Activity'] === 'Testing');
            let testHours = testTasks.reduce((acc, t) => acc + parseFloat(t['Original Estimation'] || 0), 0);

            // تحديد موعد جاهزية القصة (اليوم التالي الساعة 9 صباحاً)
            let storyReadyForTest = new Date(story.calc.devEnd);
            storyReadyForTest.setDate(storyReadyForTest.getDate() + 1);
            storyReadyForTest.setHours(9, 0, 0, 0);

            // التحقق من توفر المختبر
            let testerNextAvailableSlot = testerAvailability[story.tester] || storyReadyForTest;
            let actualTestStart = new Date(Math.max(storyReadyForTest, testerNextAvailableSlot));

            // هـام: التأكد أن بداية الاختبار تقع في يوم عمل (وليس جمعة أو سبت أو إجازة رسمية)
            while (!dateEngine.isWorkDay(actualTestStart, story.tester)) {
                actualTestStart.setDate(actualTestStart.getDate() + 1);
                actualTestStart.setHours(CONFIG.START_HOUR, 0, 0, 0);
            }

            story.calc.testEnd = dateEngine.addWorkingHours(actualTestStart, Math.max(0, testHours), story.tester);
            testerAvailability[story.tester] = new Date(story.calc.testEnd);

            // 3. حساب الريورك (Bugs Rework)
            let lastBugEndDate = new Date(story.calc.testEnd);
            if (story.bugs && story.bugs.length > 0) {
                story.bugs.forEach(bug => {
                    const bugEffort = parseFloat(bug['Original Estimation'] || 0);
                    const bugActivatedDate = bug['Activated Date'] ? new Date(bug['Activated Date']) : null;

                    if (bugActivatedDate && bugEffort > 0) {
                        const bugFinish = dateEngine.addWorkingHours(bugActivatedDate, bugEffort, story.assignedTo);
                        if (bugFinish > lastBugEndDate) lastBugEndDate = bugFinish;
                    }
                });
            }
            story.calc.finalEnd = lastBugEndDate;
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
        const active = currentData.filter(s => s.state !== 'Tested');
        const tested = currentData.filter(s => s.state === 'Tested');
        const delayed = active.filter(s => s.calc.finalEnd instanceof Date && new Date() > s.calc.finalEnd);

        const statsHtml = `
            <div class="bg-blue-600 text-white p-4 rounded-xl shadow">
                <div class="text-sm opacity-80">القصص النشطة</div>
                <div class="text-2xl font-bold">${active.length}</div>
            </div>
            <div class="bg-green-600 text-white p-4 rounded-xl shadow">
                <div class="text-sm opacity-80">بانتظار التسليم</div>
                <div class="text-2xl font-bold">${tested.length}</div>
            </div>
            <div class="bg-red-600 text-white p-4 rounded-xl shadow">
                <div class="text-sm opacity-80">متأخرة</div>
                <div class="text-2xl font-bold">${delayed.length}</div>
            </div>
            <div class="bg-purple-600 text-white p-4 rounded-xl shadow">
                <div class="text-sm opacity-80">تم تسليمها</div>
                <div class="text-2xl font-bold">${db.deliveryLogs.length}</div>
            </div>
        `;
        document.getElementById('stats-cards').innerHTML = statsHtml;

        const today = new Date().toISOString().split('T')[0];
        document.getElementById('overdue-container').innerHTML = delayed.map(s => `
            <div class="p-2 border-b text-sm">
                <span class="font-bold">[${s.area}]</span> ${s.title}
                <div class="text-xs text-red-400">تأخير منذ: ${s.calc.finalEnd.toLocaleDateString()}</div>
            </div>
        `).join('');

        document.getElementById('today-container').innerHTML = active.filter(s => {
            return s.calc.finalEnd instanceof Date && s.calc.finalEnd.toISOString().split('T')[0] === today;
        }).map(s => `
            <div class="p-2 border-b text-sm">
                <span class="font-bold">[${s.area}]</span> ${s.title} - <span class="text-blue-500">${s.assignedTo}</span>
            </div>
        `).join('') || '<div class="text-gray-400 text-center">لا يوجد شيء مخطط له اليوم</div>';
    },

renderActiveCards() {
    const container = document.getElementById('active-cards-container');
    const activeStories = currentData.filter(s => s.state !== 'Tested');
    
    if (activeStories.length === 0) {
        container.innerHTML = `<div class="col-span-full text-center py-20 text-gray-400">No active stories found.</div>`;
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
                // --- دمج التعريفات التي كانت تسبب الخطأ ---
                const isLate = s.calc.finalEnd instanceof Date && new Date() > s.calc.finalEnd;
                const hasError = s.calc.error;
                const priorityBadge = `<span class="px-2 py-0.5 rounded bg-gray-100 text-[10px] font-bold text-gray-600">P${s.priority || 999}</span>`;
                
                let statusColor = "bg-blue-100 text-blue-700";
                if(isLate) statusColor = "bg-red-100 text-red-700";
                if(hasError) statusColor = "bg-amber-100 text-amber-700";

                return `
                    <div class="bg-white rounded-2xl shadow-sm border border-gray-100 hover:shadow-md transition-shadow overflow-hidden flex flex-col">
                        <div class="p-5 flex-1">
                            <div class="flex justify-between items-start mb-4">
                                <div class="flex gap-2">
                                    <span class="px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider ${statusColor}">
                                        ${hasError ? 'Action Required' : (isLate ? 'Overdue ⚠️' : s.state)}
                                    </span>
                                    ${priorityBadge}
                                </div>
                                <span class="text-xs font-mono text-gray-400">#${s.id}</span>
                            </div>
                            
                            <h3 class="text-lg font-bold text-slate-800 mb-1 leading-tight">${s.title}</h3>

                            <div class="grid grid-cols-2 gap-4 py-4 border-t border-gray-50 mt-4">
                                <div>
                                    <p class="text-[10px] uppercase text-gray-400 font-bold mb-1">Development</p>
                                    <p class="text-sm font-medium text-slate-700 flex items-center gap-2">
                                        <span class="w-6 h-6 rounded-full bg-slate-100 flex items-center justify-center text-[10px]">🛠</span>
                                        ${s.assignedTo}
                                    </p>
                                    <p class="text-[10px] text-gray-500 mt-1 italic">
                                        Ends: ${hasError ? 'Pending' : (s.calc.devEnd instanceof Date ? s.calc.devEnd.toLocaleDateString('en-GB') : s.calc.devEnd)}
                                    </p>
                                </div>
                                <div>
                                    <p class="text-[10px] uppercase text-gray-400 font-bold mb-1">Quality Assurance</p>
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
        const tested = currentData.filter(s => s.state === 'Tested');

        if (tested.length === 0) {
            container.innerHTML = `<div class="col-span-full text-center py-10 text-gray-400">لا توجد عناصر جاهزة للتسليم حالياً.</div>`;
            return;
        }

        // 1. تجميع البيانات حسب Business Area
        const grouped = tested.reduce((acc, story) => {
            const area = story.area || "General";
            if (!acc[area]) acc[area] = [];
            acc[area].push(story);
            return acc;
        }, {});

        let html = '';

        // 2. المرور على كل منطقة (Area)
        Object.keys(grouped).forEach(area => {
            // 3. ترتيب القصص داخل المنطقة: غير المستلم أولاً
            const sortedStories = grouped[area].sort((a, b) => {
                const aLogged = db.deliveryLogs.some(l => l.storyId === a.id);
                const bLogged = db.deliveryLogs.some(l => l.storyId === b.id);
                return aLogged - bLogged; // false (0) قبل true (1)
            });

            html += `
                <div class="col-span-full mt-6 mb-2">
                    <h3 class="text-lg font-bold text-slate-700 border-r-4 border-blue-500 pr-2">${area}</h3>
                </div>
            `;

            html += sortedStories.map(s => {
                const log = db.deliveryLogs.find(l => l.storyId === s.id);
                const isLogged = !!log;

                return `
                    <div class="bg-white p-4 rounded-xl border-2 transition-all ${isLogged ? 'border-gray-100 opacity-60 shadow-none' : 'border-blue-200 shadow-sm hover:border-blue-400'}">
                        <div class="flex justify-between items-start mb-2">
                            <span class="text-[10px] font-mono text-gray-400">#${s.id}</span>
                            ${isLogged ? '<span class="text-green-500 text-xs font-bold">✓ تم التسليم</span>' : '<span class="text-blue-500 text-xs font-bold italic text-animate-pulse">بانتظار التسليم</span>'}
                        </div>
                        <div class="font-bold text-slate-800 mb-4 leading-snug">${s.title}</div>
                        
                        ${isLogged ? `
                            <div class="text-xs bg-green-50 text-green-700 p-2 rounded-lg border border-green-100">
                                <b>المستلم:</b> ${log.to}<br>
                                <b>التاريخ:</b> ${log.date}
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
            }).join('');
        });

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
            
            // استخراج الأشخاص في هذه المنطقة وتصنيفهم
            const staffInArea = {
                developers: [...new Set(areaStories.map(s => s.assignedTo))],
                testers: [...new Set(areaStories.map(s => s.tester))]
            };

            html += `
                <div class="col-span-full mt-6">
                    <h2 class="text-xl font-bold text-indigo-800 border-b-2 border-indigo-100 pb-2 mb-4 flex items-center gap-2">
                        📍 Area: ${area}
                    </h2>
                </div>
            `;

            // وظيفة فرعية لحساب التاريخ المتاح وترتيب الأشخاص
            const getSortedStaff = (staffList, roleType) => {
                return staffList.map(person => {
                    const tasks = areaStories.filter(s => 
                        (roleType === 'dev' ? s.assignedTo === person : s.tester === person)
                    );
                    
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
                    // الترتيب: المتاح (null) أولاً، ثم الأقدم تاريخاً (الأقرب للإتاحة)
                    if (a.freeDate === null) return -1;
                    if (b.freeDate === null) return 1;
                    return a.freeDate - b.freeDate;
                });
            };

            const sortedDevs = getSortedStaff(staffInArea.developers, 'dev');
            const sortedTesters = getSortedStaff(staffInArea.testers, 'test');

            // رندر المطورين
            if (sortedDevs.length > 0) {
                html += `<div class="col-span-full mb-2 mt-2 font-bold text-slate-500 text-sm uppercase tracking-widest">Developers</div>`;
                html += sortedDevs.map(dev => this.generateStaffCard(dev, "🛠")).join('');
            }

            // رندر المختبرين
            if (sortedTesters.length > 0) {
                html += `<div class="col-span-full mb-2 mt-4 font-bold text-slate-500 text-sm uppercase tracking-widest">Quality Assurance</div>`;
                html += sortedTesters.map(tester => this.generateStaffCard(tester, "🔍")).join('');
            }
        });

        container.innerHTML = html || '<div class="col-span-full text-center text-gray-400">No data available to display.</div>';
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
