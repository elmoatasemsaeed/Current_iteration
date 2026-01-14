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
    deliveryLogs: [] 
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
                db = JSON.parse(atob(data.content));
                db.sha = data.sha; 
                ui.renderAll();
            } else {
                console.log("File not found, creating new DB...");
                this.saveToGitHub();
            }
        } catch (e) { alert("خطأ في المزامنة مع GitHub"); }
    },

    async saveToGitHub() {
        const token = sessionStorage.getItem('gh_token');
        const content = btoa(unescape(encodeURIComponent(JSON.stringify(db, null, 2))));
        
        await fetch(`https://api.github.com/repos/${CONFIG.REPO_NAME}/contents/${CONFIG.FILE_PATH}`, {
            method: 'PUT',
            headers: { 'Authorization': `token ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                message: "Update Database",
                content: content,
                sha: db.sha || undefined
            })
        });
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
                if (area && area.trim().toLowerCase() === "integration") {
        area = "LDM Integration";
    }
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

        this.calculateTimelines(stories);
    },

    calculateTimelines(stories) {
        stories.forEach(story => {
            const devTasks = story.tasks.filter(t => ["Development", "DB Modification"].includes(t['Activity']));
            const devHours = devTasks.reduce((acc, t) => acc + parseFloat(t['Original Estimation'] || 0), 0);
            
            let devStart = null;
            const activatedDates = devTasks.map(t => t['Activated Date']).filter(d => d).sort();
            
            if (activatedDates.length > 0) {
                devStart = new Date(activatedDates[0]);
            }

            if (!devStart) {
                story.calc.error = "لم يتم بدء العمل (No Activated Tasks)";
                story.calc.devEnd = "بانتظار البدء";
                story.calc.testEnd = "---";
                story.calc.finalEnd = "---";
                return; 
            }

            story.calc.devEnd = dateEngine.addWorkingHours(devStart, devHours, story.assignedTo);

            const testTasks = story.tasks.filter(t => t['Activity'] === 'Testing');
            const prepTask = story.tasks.find(t => 
                t['Title'].toLowerCase().includes('preparation') || 
                t['Title'].toLowerCase().includes('prepration'));
            let testHours = testTasks.reduce((acc, t) => acc + parseFloat(t['Original Estimation'] || 0), 0);

            if (prepTask && prepTask['Activated Date']) {
                const prepStart = new Date(prepTask['Activated Date']);
                if (prepStart < story.calc.devEnd) {
                    testHours -= parseFloat(prepTask['Original Estimation'] || 0);
                }
            }

            let testStart = new Date(story.calc.devEnd);
            testStart.setDate(testStart.getDate() + 1);
            testStart.setHours(9, 0, 0, 0);

            story.calc.testEnd = dateEngine.addWorkingHours(testStart, Math.max(0, testHours), story.tester);

            const bugHours = story.bugs.reduce((acc, b) => acc + parseFloat(b['Original Estimation'] || 0), 0);
            story.calc.finalEnd = dateEngine.addWorkingHours(story.calc.testEnd, bugHours, story.assignedTo);
        });

        currentData = stories;
        ui.renderAll();
    }
};

/**
 * Time & Date Logic
 */
const dateEngine = {
    isWorkDay(date, person) {
        const day = date.getDay();
        const dateStr = date.toISOString().split('T')[0];
        
        if (CONFIG.WEEKEND.includes(day)) return false;
        if (db.holidays.includes(dateStr)) return false;
        if (db.vacations.some(v => v.name === person && v.date === dateStr)) return false;
        
        return true;
    },

    addWorkingHours(startDate, hours, person) {
        let result = new Date(startDate);
        let remainingHours = hours;

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

    // 1. تجميع البيانات حسب Business Area وترتيبها داخلياً (المتأخر أولاً)
    const groupedStories = activeStories.reduce((groups, story) => {
        const area = story.area || "General";
        if (!groups[area]) groups[area] = [];
        groups[area].push(story);
        return groups;
    }, {});

    // تحويل الكائن إلى مصفوفة للتمكن من عرضها وترتيب القصص داخل كل مجموعة
    container.innerHTML = Object.keys(groupedStories).map(area => {
        const storiesInArea = groupedStories[area].sort((a, b) => {
            const isALate = a.calc.finalEnd instanceof Date && new Date() > a.calc.finalEnd;
            const isBLate = b.calc.finalEnd instanceof Date && new Date() > b.calc.finalEnd;
            return isBLate - isALate; // المتأخر (true) يظهر أولاً
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
                const isLate = s.calc.finalEnd instanceof Date && new Date() > s.calc.finalEnd;
                const hasError = s.calc.error;
                
                let statusColor = "bg-blue-100 text-blue-700";
                if(isLate) statusColor = "bg-red-100 text-red-700";
                if(hasError) statusColor = "bg-amber-100 text-amber-700";

                return `
                    <div class="bg-white rounded-2xl shadow-sm border border-gray-100 hover:shadow-md transition-shadow overflow-hidden flex flex-col">
                        <div class="p-5 flex-1">
                            <div class="flex justify-between items-start mb-4">
                                <span class="px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider ${statusColor}">
                                    ${hasError ? 'Action Required' : (isLate ? 'Overdue ⚠️' : s.state)}
                                </span>
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
                                        Ends: ${hasError ? 'Pending' : new Date(s.calc.devEnd).toLocaleDateString('en-GB')}
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

        container.innerHTML = tested.map(s => {
            const isLogged = db.deliveryLogs.find(l => l.storyId === s.id);
            return `
                <div class="bg-white p-4 rounded-xl border-2 ${isLogged ? 'border-green-500 opacity-60' : 'border-blue-200'}">
                    <div class="font-bold">${s.title}</div>
                    <div class="text-xs text-gray-500 mb-4">ID: ${s.id} | Area: ${s.area}</div>
                    ${isLogged ? `
                        <div class="text-xs bg-green-100 p-2 rounded">
                            ✅ تم التسليم لـ ${isLogged.to}
                        </div>
                    ` : `
                        <div class="flex gap-2">
                            <input id="to-${s.id}" placeholder="المستلم" class="text-xs border p-1 rounded flex-1">
                            <button onclick="ui.markDelivered('${s.id}')" class="bg-blue-600 text-white px-2 py-1 rounded text-xs">تأكيد</button>
                        </div>
                    `}
                </div>
            `;
        }).join('');
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
