/**
 * Configuration & Global State
 */
const CONFIG = {
    REPO_NAME: "elmoatasemsaeed/Current_iteration", // يجب تغيير هذا لاسم حسابك والمستودع
    FILE_PATH: "db.json",
    WORKING_HOURS: 5,
    START_HOUR: 9,
    END_HOUR: 17,
    WEEKEND: [5, 6] // الجمعة والسبت
};

let db = {
    users: [],
    vacations: [], // { name, date }
    holidays: [],  // ["YYYY-MM-DD"]
    deliveryLogs: [] // { storyId, to, method, date, timestamp }
};

let currentData = []; // البيانات القادمة من CSV بعد المعالجة
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

        // تخزين مؤقت للتوكن للعمليات الحالية
        sessionStorage.setItem('gh_token', t);
        if(rem) localStorage.setItem('saved_creds', JSON.stringify({u, p, t}));

        currentUser = { username: u, role: 'admin' };
        this.startApp();
    },

    startApp() {
        document.getElementById('login-screen').classList.add('hidden');
        document.getElementById('app-container').classList.remove('hidden');
        dataProcessor.sync(); // جلب البيانات من جيت هب عند البداية
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
                db.sha = data.sha; // نحتاجه للتحديث اللاحق
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
                // استخراج الـ Business Area حسب المنطق المطلوب
                let area = row['Business Area'];
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
        // 1. حساب الـ Dev
        const devTasks = story.tasks.filter(t => ["Development", "DB Modification"].includes(t['Activity']));
        const devHours = devTasks.reduce((acc, t) => acc + parseFloat(t['Original Estimation'] || 0), 0);
        
        // تغيير المنطق هنا: البحث عن تواريخ التفعيل
        let devStart = null;
        const activatedDates = devTasks.map(t => t['Activated Date']).filter(d => d).sort();
        
        if (activatedDates.length > 0) {
            devStart = new Date(activatedDates[0]);
        }

        // إذا لم يوجد تاريخ تفعيل، لا تقم بالحسابات وضع تنبيه
        if (!devStart) {
            story.calc.error = "لم يتم بدء العمل (No Activated Tasks)";
            story.calc.devEnd = "بانتظار البدء";
            story.calc.testEnd = "---";
            story.calc.finalEnd = "---";
            return; // تخطي الحساب لهذه القصة
        }

        story.calc.devEnd = dateEngine.addWorkingHours(devStart, devHours, story.assignedTo);


            // 2. حساب الـ Test
            const testTasks = story.tasks.filter(t => t['Activity'] === 'Testing');
            const prepTask = story.tasks.find(t => 
    t['Title'].toLowerCase().includes('preparation') || 
    t['Title'].toLowerCase().includes('prepration'));
            let testHours = testTasks.reduce((acc, t) => acc + parseFloat(t['Original Estimation'] || 0), 0);

            // منطق الـ Preparation Overlap
            if (prepTask && prepTask['Activated Date']) {
                const prepStart = new Date(prepTask['Activated Date']);
                if (prepStart < story.calc.devEnd) {
                    testHours -= parseFloat(prepTask['Original Estimation'] || 0);
                }
            }

            // بداية التيست: اليوم التالي 9 صباحاً
            let testStart = new Date(story.calc.devEnd);
            testStart.setDate(testStart.getDate() + 1);
            testStart.setHours(9, 0, 0, 0);

            story.calc.testEnd = dateEngine.addWorkingHours(testStart, Math.max(0, testHours), story.tester);

            // 3. حساب الـ Rework (Bugs)
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
            // التحقق من اليوم
            if (this.isWorkDay(result, person)) {
                // الساعات المتاحة في هذا اليوم (من 9 لـ 5 هي 8 ساعات، لكننا نعمل 5)
                // للتبسيط: كل ساعة عمل تاخد (8/5) من وقت اليوم الفعلي
                let currentHour = result.getHours();
                if (currentHour >= CONFIG.START_HOUR && currentHour < CONFIG.END_HOUR) {
                    remainingHours -= (CONFIG.WORKING_HOURS / (CONFIG.END_HOUR - CONFIG.START_HOUR));
                }
            }
            
            result.setHours(result.getHours() + 1);
            
            // لو اليوم خلص (بعد الساعة 5 مساءً) ننتقل لليوم التالي 9 صباحاً
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
        this.renderActiveTable();
        this.renderDelivery();
        this.renderAvailability();
        this.renderSettings();
    },

    renderStats() {
        const active = currentData.filter(s => s.state !== 'Tested');
        const tested = currentData.filter(s => s.state === 'Tested');
        const delayed = active.filter(s => new Date() > s.calc.finalEnd);

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
                <div class="text-sm opacity-80">تم تسليمها (3 شهور)</div>
                <div class="text-2xl font-bold">${db.deliveryLogs.length}</div>
            </div>
        `;
        document.getElementById('stats-cards').innerHTML = statsHtml;

        // القائمة المتأخرة واليومية
        const today = new Date().toISOString().split('T')[0];
        document.getElementById('overdue-container').innerHTML = delayed.map(s => `
            <div class="p-2 border-b text-sm">
                <span class="font-bold">[${s.area}]</span> ${s.title}
                <div class="text-xs text-red-400">تأخير منذ: ${s.calc.finalEnd.toLocaleDateString()}</div>
            </div>
        `).join('');

        document.getElementById('today-container').innerHTML = active.filter(s => s.calc.finalEnd.toISOString().split('T')[0] === today).map(s => `
            <div class="p-2 border-b text-sm">
                <span class="font-bold">[${s.area}]</span> ${s.title} - <span class="text-blue-500">${s.assignedTo}</span>
            </div>
        `).join('') || '<div class="text-gray-400 text-center">لا يوجد شيء مخطط له اليوم</div>';
    },

renderActiveTable() {
    const tbody = document.getElementById('active-table-body');
    const activeStories = currentData.filter(s => s.state !== 'Tested');
    
    // ... منطق الـ Grouping كما هو ...

    let html = '';
    for (const area in grouped) {
        grouped[area].forEach((s, index) => {
            const isLate = s.calc.finalEnd instanceof Date && new Date() > s.calc.finalEnd;
            const hasError = s.calc.error; // التنبيه الجديد

            html += `
                <tr class="${isLate ? 'status-delayed' : ''} ${hasError ? 'bg-yellow-50' : ''} hover:bg-gray-50">
                    ${index === 0 ? `<td class="p-3 border font-bold" rowspan="${grouped[area].length}">${area}</td>` : ''}
                    <td class="p-3 border text-sm">${s.title}</td>
                    <td class="p-3 border text-xs">🛠 ${s.assignedTo}<br>🔍 ${s.tester}</td>
                    <td class="p-3 border text-xs ${hasError ? 'text-orange-600 font-bold' : ''}">
                        ${hasError ? s.calc.devEnd : s.calc.devEnd.toLocaleString()}
                    </td>
                    <td class="p-3 border text-xs">
                        ${s.calc.testEnd instanceof Date ? s.calc.testEnd.toLocaleString() : s.calc.testEnd}
                    </td>
                    <td class="p-3 border text-xs font-bold">
                        ${s.calc.finalEnd instanceof Date ? s.calc.finalEnd.toLocaleString() : s.calc.finalEnd}
                    </td>
                    <td class="p-3 border text-xs">${s.state}</td>
                </tr>
            `;
        });
    }
        tbody.innerHTML = html;
    },

    renderDelivery() {
        const container = document.getElementById('delivery-grid');
        const tested = currentData.filter(s => s.state === 'Tested');

        container.innerHTML = tested.map(s => {
            const isLogged = db.deliveryLogs.find(l => l.storyId === s.id);
            return `
                <div class="bg-white p-4 rounded-xl border-2 ${isLogged ? 'border-green-500 shadow-inner opacity-60' : 'border-blue-200'}">
                    <div class="font-bold">${s.title}</div>
                    <div class="text-xs text-gray-500 mb-4">ID: ${s.id} | Area: ${s.area}</div>
                    ${isLogged ? `
                        <div class="text-xs bg-green-100 p-2 rounded">
                            ✅ تم التسليم لـ ${isLogged.to} عبر ${isLogged.method} بتاريخ ${isLogged.date}
                        </div>
                    ` : `
                        <div class="flex gap-2">
                            <input id="to-${s.id}" placeholder="إلى من؟" class="text-xs border p-1 rounded flex-1">
                            <select id="how-${s.id}" class="text-xs border p-1 rounded">
                                <option>إيميل</option><option>واتساب</option><option>شخصي</option>
                            </select>
                            <button onclick="ui.markDelivered('${s.id}')" class="bg-blue-600 text-white px-3 py-1 rounded text-xs">تأكيد تسليم</button>
                        </div>
                    `}
                </div>
            `;
        }).join('');
    },

    markDelivered(id) {
        const to = document.getElementById(`to-${id}`).value;
        const method = document.getElementById(`how-${id}`).value;
        if(!to) return alert("اكتب المستلم أولاً");

        db.deliveryLogs.push({
            storyId: id,
            to: to,
            method: method,
            date: new Date().toLocaleDateString(),
            timestamp: Date.now()
        });

        // تنظيف البيانات التي مر عليها أكثر من 3 أشهر
        const threeMonthsAgo = Date.now() - (90 * 24 * 60 * 60 * 1000);
        db.deliveryLogs = db.deliveryLogs.filter(l => l.timestamp > threeMonthsAgo);

        dataProcessor.saveToGitHub();
        this.renderDelivery();
    },

    renderAvailability() {
        const container = document.getElementById('availability-container');
        const staff = [...new Set(currentData.map(s => s.assignedTo).concat(currentData.map(s => s.tester)))];
        
        container.innerHTML = staff.map(person => {
            const tasks = currentData.filter(s => (s.assignedTo === person || s.tester === person) && s.state !== 'Tested');
            const sorted = tasks.sort((a, b) => b.calc.finalEnd - a.calc.finalEnd);
            const freeDate = sorted.length > 0 ? sorted[0].calc.finalEnd.toLocaleString() : "متاح الآن";
            
            return `
                <div class="bg-white p-4 rounded-lg shadow-sm border-t-4 border-indigo-500">
                    <div class="font-bold text-lg">${person}</div>
                    <div class="text-sm text-gray-500 mt-1">سيكون متاحاً في:</div>
                    <div class="text-blue-700 font-bold">${freeDate}</div>
                </div>
            `;
        }).join('');
    },

    renderSettings() {
        const staff = [...new Set(currentData.map(s => s.assignedTo).concat(currentData.map(s => s.tester)))];
        const staffSelect = document.getElementById('staff-select');
        staffSelect.innerHTML = staff.map(s => `<option value="${s}">${s}</option>`).join('');

        document.getElementById('vacations-list').innerHTML = db.vacations.map((v, i) => `
            <div class="flex justify-between bg-gray-50 p-1 px-2 rounded">
                <span>${v.name} - ${v.date}</span>
                <button onclick="settings.removeVacation(${i})" class="text-red-500 font-bold">×</button>
            </div>
        `).join('');

        document.getElementById('holidays-list').innerHTML = db.holidays.map((h, i) => `
            <span class="bg-gray-200 px-2 py-1 rounded text-xs flex items-center gap-1">
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

// تشغيل تلقائي إذا كانت البيانات محفوظة
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
