/**
 * UI Controller with Lazy Tab Rendering & Debounced Search
 */
const ui = {
    _dirtyTabs: new Set([
        'dashboard', 'active', 'delivery', 'workload', 'daily-activity',
        'inactive-stories', 'kanban', 'pull-requests', 'support-kanban', 'auditor', 'settings'
    ]),

    showLoader() {
        let loader = document.getElementById('project-loader');
        if (!loader) {
            loader = document.createElement('div');
            loader.id = 'project-loader';
            loader.className = 'fixed inset-0 bg-black/30 flex items-center justify-center z-[3000] hidden';
            loader.innerHTML = `
                <div class="bg-white p-6 rounded-xl shadow-2xl flex items-center gap-4">
                    <div class="w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin"></div>
                    <span class="font-bold text-slate-700">صلي ع النبي ...</span>
                </div>
            `;
            document.body.appendChild(loader);
        }
        loader.classList.remove('hidden');
    },

    hideLoader() {
        const loader = document.getElementById('project-loader');
        if (loader) loader.classList.add('hidden');
    },

    showToast(message, type = 'success') {
        const existing = document.querySelector('.toast-message');
        if (existing) existing.remove();
        const toast = document.createElement('div');
        toast.className = `toast-message fixed top-4 right-4 z-[5000] px-6 py-3 rounded-xl shadow-2xl text-white font-bold text-sm transition-all duration-500 ${type === 'success' ? 'bg-google-green' : 'bg-google-red'}`;
        toast.innerText = message;
        document.body.appendChild(toast);
        setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 500); }, 3000);
    },

    _markAllTabsDirty() {
        [
            'dashboard', 'active', 'delivery', 'workload', 'daily-activity',
            'inactive-stories', 'kanban', 'pull-requests', 'support-kanban', 'auditor', 'settings'
        ].forEach(t => this._dirtyTabs.add(t));
    },

    _renderTabById(tabId) {
        this._dirtyTabs.delete(tabId);
        switch (tabId) {
            case 'dashboard': this.renderDashboard(); break;
            case 'active': this.renderActiveCards(); break;
            case 'delivery': this.renderDelivery(); break;
            case 'workload': this.renderWorkload(); break;
            case 'daily-activity': this.renderDailyActivity(); break;
            case 'inactive-stories': this.renderInactiveStories(); break;
            case 'kanban': this.renderKanban(); break;
            case 'auditor': this.renderAuditorChecklist(); break;
            case 'support-kanban': this.renderSupportKanban(); break;
            case 'pull-requests': this.renderPullRequestsTab(); break;
            case 'settings': this.renderSettings(); break;
            default: break;
        }
    },

    switchTab(tabId) {
        document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
        const target = document.getElementById(`tab-${tabId}`);
        if (target) target.classList.add('active');

        document.querySelectorAll('nav .nav-btn').forEach(btn => {
            const onclickAttr = btn.getAttribute('onclick') || '';
            btn.classList.toggle('active', onclickAttr.includes(`'${tabId}'`));
        });

        if (currentUser && currentUser.role === 'viewer') {
            const uploadBtn = document.querySelector("button[onclick*='csv-input']");
            if (uploadBtn) uploadBtn.style.display = 'none';
            const settingsNav = document.querySelector("button[onclick*='settings']");
            if (settingsNav) settingsNav.style.display = 'none';
        }

        if (this._dirtyTabs.has(tabId)) {
            this._renderTabById(tabId);
        }
    },

    renderAll() {
        this._markAllTabsDirty();
        if (currentUser && currentUser.role === 'viewer') {
            const uploadBtn = document.querySelector("button[onclick*='csv-input']");
            if (uploadBtn) uploadBtn.style.display = 'none';
            const settingsNav = document.querySelector("button[onclick*='settings']");
            if (settingsNav) settingsNav.style.display = 'none';
        }
        const activeTab = document.querySelector('.tab-content.active');
        if (!activeTab) return;
        const tabId = activeTab.id.replace(/^tab-/, '');
        this._renderTabById(tabId);
    },

    // =================================================================
    // PULL REQUEST STATS HELPERS
    // =================================================================
    calculatePRStats() {
        const prs = db.pullRequests || [];
        const threeDaysMs = 3 * 24 * 60 * 60 * 1000;
        const now = Date.now();

        const completedPRs = [];
        const stalePRs = [];
        const approvedNotCompletedPRs = [];
        let activeCount = 0;
        let abandonedCount = 0;
        let cycleTimeSum = 0;

        for (const pr of prs) {
            if (pr.status === 'completed') {
                if (pr.cycleTimeHours != null) {
                    completedPRs.push(pr);
                    cycleTimeSum += pr.cycleTimeHours;
                }
            } else if (pr.status === 'abandoned') {
                abandonedCount++;
            } else if (pr.status === 'active') {
                activeCount++;
                const hasApproval = (pr.reviewers || []).some(r => r.vote >= 5);
                if (hasApproval) {
                    approvedNotCompletedPRs.push(pr);
                } else if (pr.creationDate && (now - new Date(pr.creationDate).getTime()) >= threeDaysMs) {
                    stalePRs.push(pr);
                }
            }
        }

        return {
            active: activeCount,
            approvedNotCompleted: approvedNotCompletedPRs.length,
            total: prs.length,
            completed: completedPRs.length,
            abandoned: abandonedCount,
            avgCycleTime: completedPRs.length > 0 ? cycleTimeSum / completedPRs.length : 0,
            stalePRs,
            approvedNotCompletedPRs
        };
    },

    showStalePRs() {
        const modal = document.getElementById('story-modal');
        const titleEl = document.getElementById('modal-title');
        const body = document.getElementById('modal-body');
        const stats = this.calculatePRStats();
        titleEl.innerText = `⚠️ Stale Pull Requests (>3 days, no approval) — ${stats.stalePRs.length}`;

        if (stats.stalePRs.length === 0) {
            body.innerHTML = `<div class="text-center py-10 text-gray-400">لا توجد PRs قديمة. ممتاز! 🎉</div>`;
        } else {
            const now = Date.now();
            body.innerHTML = `<div class="space-y-2">${stats.stalePRs.map(pr => {
                const days = Math.floor((now - new Date(pr.creationDate).getTime()) / (1000 * 60 * 60 * 24));
                return `
                    <div class="bg-google-red-light border border-google-red/30 p-3 rounded-lg">
                        <div class="flex justify-between items-start gap-2">
                            <div class="min-w-0 flex-1">
                                <span class="font-mono text-google-red font-bold">#${pr.id}</span>
                                <span class="text-sm text-slate-700 ml-2">${escapeHtml(pr.title)}</span>
                            </div>
                            <span class="bg-google-red text-white text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap">${days} days</span>
                        </div>
                        <div class="text-xs text-gray-500 mt-1">
                            By ${escapeHtml(pr.createdBy)} · Repo: ${escapeHtml(pr.repository)} · Story: #${pr.linkedStoryId || 'N/A'}
                        </div>
                        <div class="text-xs text-gray-400 mt-1">
                            Reviewers: ${pr.reviewers.map(r => `${escapeHtml(r.name)} (vote: ${r.vote})`).join(', ') || 'None'}
                        </div>
                    </div>
                `;
            }).join('')}</div>`;
        }

        modal.classList.remove('hidden');
        document.body.style.overflow = 'hidden';
    },

    renderPullRequestsForStory(story) {
        const prs = story.pullRequests || [];
        if (!prs || prs.length === 0) return '';

        const statusMap = {
            active:    { label: 'Active',    cls: 'bg-blue-100 text-blue-700 border-blue-300' },
            completed: { label: 'Completed', cls: 'bg-green-100 text-green-700 border-green-300' },
            abandoned: { label: 'Abandoned', cls: 'bg-gray-100 text-gray-600 border-gray-300' }
        };

        return `
            <div class="space-y-2">
                <h4 class="font-bold text-indigo-700 border-b pb-1 flex items-center gap-2">
                    🔀 Pull Requests (${prs.length})
                </h4>
                ${prs.map(pr => {
                    const cfg = statusMap[pr.status] || statusMap.active;
                    const created = pr.creationDate ? new Date(pr.creationDate).toLocaleDateString('en-GB') : '—';
                    const cycle = (pr.cycleTimeHours != null) ? `${pr.cycleTimeHours.toFixed(1)}h` : '—';
                    return `
                        <div class="flex justify-between items-start text-[11px] bg-white border border-indigo-100 p-2 rounded-lg shadow-sm gap-2">
                            <div class="flex flex-col min-w-0 flex-1">
                                <div class="flex items-center gap-2">
                                    <span class="font-mono text-indigo-600 font-bold">#${pr.id}</span>
                                    <span class="text-slate-700 truncate" title="${escapeHtml(pr.title)}">${escapeHtml(pr.title)}</span>
                                </div>
                                <span class="text-gray-400 text-[9px] mt-1">Created: ${created} · by ${escapeHtml(pr.createdBy)} · Repo: ${escapeHtml(pr.repository)}</span>
                                ${pr.reviewers && pr.reviewers.length > 0 ? `
                                    <span class="text-gray-400 text-[9px] mt-0.5">👥 ${pr.reviewers.map(r => `${escapeHtml(r.name)} (${r.vote >= 5 ? '✅' : r.vote <= -5 ? '❌' : '⏳'})`).join(' · ')}</span>
                                ` : ''}
                            </div>
                            <div class="flex flex-col items-end gap-1 shrink-0">
                                <span class="px-2 py-0.5 rounded-full text-[9px] font-bold border ${cfg.cls}">${cfg.label}</span>
                                <span class="text-[9px] text-gray-500 font-mono">⏱ ${cycle}</span>
                            </div>
                        </div>
                    `;
                }).join('')}
            </div>
        `;
    },

    calculatePRStatsByArea() {
        const prs = db.pullRequests || [];
        const storyMap = new Map();
        const childItemMap = new Map();
        const childToParent = new Map();

        const getItemId = (item) => {
            if (!item) return null;
            const id = item.ID ?? item.id ?? item.Id;
            return id != null ? id.toString() : null;
        };

        const indexStory = (story) => {
            if (!story) return;
            const storyId = getItemId(story);
            if (!storyId) return;
            storyMap.set(storyId, story);
            const indexChild = (child) => {
                const childId = getItemId(child);
                if (!childId) return;
                childItemMap.set(childId, child);
                childToParent.set(childId, story);
            };
            (story.tasks || []).forEach(indexChild);
            (story.bugs || []).forEach(indexChild);
            (story.testCases || []).forEach(indexChild);
            (story.reviews || []).forEach(indexChild);
        };

        (db.currentStories || []).forEach(indexStory);
        (db.backlogStories || []).forEach(indexStory);

        const TEAM_NAME_TO_AREA = {
            'registration team': 'Registration',
            'internallab team': 'Internal lab',
            'internal lab team': 'Internal lab',
            'front team': 'Front and Financial'
        };

        const resolveAreaFromWorkItem = (item, { allowGeneral = true } = {}) => {
            if (!item) return allowGeneral ? 'General' : null;

            const type = String(item.type || item['Work Item Type'] || '').trim();
            if (/^support\s*log$/i.test(type)) return 'Support Log';

            let area = String(item.area ?? item['Business Area'] ?? '').trim();
            const path = String(item.iterationPath ?? item['Iteration Path'] ?? '').trim();

            if (!area && !path && !allowGeneral) return null;
            if (area.toLowerCase() === 'integration') area = 'LDM Integration';

            if (!area) {
                area = path.includes('\\') ? path.split('\\')[0].trim() : path.trim();
                if (area.toLowerCase() === 'integration') area = 'LDM Integration';
            }

            if (area && area.toUpperCase() === 'LDM' && path.includes('\\')) {
                const segments = path.split('\\').map(s => s.trim()).filter(Boolean);
                if (segments.length > 1) {
                    area = segments[1];
                    if (area.toLowerCase() === 'integration') area = 'LDM Integration';
                }
            }

            if (area) {
                const mapped = TEAM_NAME_TO_AREA[area.trim().toLowerCase()];
                if (mapped) area = mapped;
            }

            return area || (allowGeneral ? 'General' : null);
        };

        const resolveAreaFromId = (id, visited = new Set()) => {
            if (!id) return null;
            id = id.toString();
            if (visited.has(id)) return null;
            visited.add(id);

            if (storyMap.has(id)) {
                return resolveAreaFromWorkItem(storyMap.get(id), { allowGeneral: false });
            }

            if (childItemMap.has(id)) {
                const child = childItemMap.get(id);
                const childArea = resolveAreaFromWorkItem(child, { allowGeneral: false });
                if (childArea) return childArea;

                const parent = childToParent.get(id);
                if (parent) {
                    return resolveAreaFromWorkItem(parent, { allowGeneral: false });
                }
            }

            if (db.workItemsMap && db.workItemsMap[id]) {
                const wi = db.workItemsMap[id];
                const pseudoItem = {
                    id: wi.id,
                    type: wi.type,
                    area: wi.area,
                    iterationPath: wi.iterationPath,
                    'Business Area': wi.area,
                    'Iteration Path': wi.iterationPath
                };
                const wiArea = resolveAreaFromWorkItem(pseudoItem, { allowGeneral: false });
                if (wiArea) return wiArea;

                if (wi.parentId) {
                    const parentArea = resolveAreaFromId(wi.parentId, visited);
                    if (parentArea) return parentArea;
                }
            }

            return null;
        };

        const areaMap = {};
        const now = Date.now();
        const THREE_DAYS = 3 * 24 * 60 * 60 * 1000;

        const ensureArea = (area) => {
            if (!areaMap[area]) {
                areaMap[area] = {
                    area,
                    total: 0, active: 0, completed: 0, abandoned: 0,
                    approved: 0, stalled: 0, stalledDaysTotal: 0,
                    approvedNotCompleted: 0,
                    cycleTimes: [], prs: []
                };
            }
            return areaMap[area];
        };

        prs.forEach(pr => {
            let area = 'Unlinked';
            const prTitle = (pr.title || '').trim();
            const prRepo = (pr.repository || '').trim();

            if (/^(SL|Support\s*Log)(?:\b|_)/i.test(prTitle)) {
                area = 'Support Log';
            } else if (/^integration(?:\b|_|\/|-)/i.test(prTitle)) {
                area = 'LDM Integration';
            } else if (prRepo && prRepo.toUpperCase() !== 'LDM') {
                area = prRepo;
            } else if (pr.linkedStoryId) {
                const resolvedArea = resolveAreaFromId(pr.linkedStoryId);
                if (resolvedArea) area = resolvedArea;
            }

            const a = ensureArea(area);
            a.total++;
            a.prs.push(pr);

            const hasApproval = (pr.reviewers || []).some(r => r.vote >= 5);
            if (hasApproval) a.approved++;

            if (pr.status === 'active') {
                a.active++;
                if (hasApproval) {
                    a.approvedNotCompleted++;
                } else if (pr.creationDate) {
                    const ageMs = now - new Date(pr.creationDate).getTime();
                    if (ageMs >= THREE_DAYS) {
                        a.stalled++;
                        a.stalledDaysTotal += Math.floor(ageMs / (1000 * 60 * 60 * 24));
                    }
                }
            } else if (pr.status === 'completed') {
                a.completed++;
                if (pr.cycleTimeHours != null) a.cycleTimes.push(pr.cycleTimeHours);
            } else if (pr.status === 'abandoned') {
                a.abandoned++;
            }
        });

        return Object.values(areaMap).map(a => ({
            ...a,
            avgCycleTime: a.cycleTimes.length > 0
                ? a.cycleTimes.reduce((s, v) => s + v, 0) / a.cycleTimes.length
                : null,
            avgStalledDays: a.stalled > 0 ? a.stalledDaysTotal / a.stalled : 0
        })).sort((a, b) => b.total - a.total);
    },

    renderPullRequestsTab() {
        const container = document.getElementById('pr-container');
        if (!container) return;

        const prStats = this.calculatePRStats();
        const areaStats = this.calculatePRStatsByArea();

        const summaryHtml = `
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                <div class="bg-gradient-to-br from-blue-100 to-blue-200 p-6 rounded-2xl shadow-lg text-slate-800">
                    <div class="text-[11px] opacity-70 font-bold uppercase tracking-wider">Active</div>
                    <div class="text-6xl font-black mt-2 text-blue-700">${prStats.active}</div>
                    <div class="text-[10px] mt-3 bg-white/60 inline-block px-2 py-0.5 rounded font-bold">
                        Open PRs · needs review / merge
                    </div>
                </div>
                <div class="bg-gradient-to-br from-teal-100 to-teal-200 p-6 rounded-2xl shadow-lg text-slate-800">
                    <div class="text-[11px] opacity-70 font-bold uppercase tracking-wider">Approved · Not Completed</div>
                    <div class="text-6xl font-black mt-2 text-teal-700">${prStats.approvedNotCompleted}</div>
                    <div class="text-[10px] mt-3 bg-white/60 inline-block px-2 py-0.5 rounded font-bold">
                        ✅ معتمدة — مستنية merge
                    </div>
                </div>
            </div>

            <div class="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
                <div class="bg-white border border-gray-200 p-3 rounded-xl shadow-sm">
                    <div class="text-[9px] text-gray-500 font-bold uppercase tracking-wider">Total</div>
                    <div class="text-2xl font-bold mt-1 text-slate-700">${prStats.total}</div>
                </div>
                <div class="bg-white border border-gray-200 p-3 rounded-xl shadow-sm">
                    <div class="text-[9px] text-gray-500 font-bold uppercase tracking-wider">Completed</div>
                    <div class="text-2xl font-bold mt-1 text-green-600">${prStats.completed}</div>
                </div>
                <div class="bg-white border border-gray-200 p-3 rounded-xl shadow-sm">
                    <div class="text-[9px] text-gray-500 font-bold uppercase tracking-wider">Abandoned</div>
                    <div class="text-2xl font-bold mt-1 text-gray-500">${prStats.abandoned}</div>
                </div>
                <div class="bg-white border border-gray-200 p-3 rounded-xl shadow-sm">
                    <div class="text-[9px] text-gray-500 font-bold uppercase tracking-wider">Avg Cycle</div>
                    <div class="text-2xl font-bold mt-1 text-teal-600">${prStats.avgCycleTime.toFixed(1)}h</div>
                </div>
                <div onclick="ui.showStalePRs()"
                     class="bg-white border ${prStats.stalePRs.length > 0 ? 'border-red-300' : 'border-gray-200'} p-3 rounded-xl shadow-sm cursor-pointer hover:border-red-400">
                    <div class="text-[9px] text-gray-500 font-bold uppercase tracking-wider">Stalled &gt;3d</div>
                    <div class="text-2xl font-bold mt-1 ${prStats.stalePRs.length > 0 ? 'text-red-600' : 'text-gray-400'}">${prStats.stalePRs.length}</div>
                </div>
            </div>
        `;

        if (areaStats.length === 0) {
            container.innerHTML = summaryHtml + `<div class="text-center py-20 text-gray-400">No Pull Requests found. Sync with Azure to load them.</div>`;
            return;
        }

        const cardsHtml = areaStats.map(a => {
            const hasStalled = a.stalled > 0;
            const hasApprovedPending = a.approvedNotCompleted > 0;
            const alertBorder = (hasStalled || hasApprovedPending) ? 'border-orange-200' : 'border-gray-100';

            return `
                <div class="card p-5 border-2 ${alertBorder} hover:border-google-blue transition cursor-pointer"
                     onclick="ui.showAreaPRDetails('${encodeURIComponent(a.area)}')">

                    <div class="flex justify-between items-start mb-3">
                        <div class="min-w-0 flex-1 pr-2">
                            <h3 class="font-bold text-lg text-slate-800 truncate" title="${escapeHtml(a.area)}">📍 ${escapeHtml(a.area)}</h3>
                            <p class="text-[10px] uppercase font-bold ${hasApprovedPending ? 'text-teal-600' : hasStalled ? 'text-red-600' : 'text-green-600'} mt-0.5">
                                ${hasApprovedPending ? `🔔 ${a.approvedNotCompleted} ready to merge` : hasStalled ? `⚠️ ${a.stalled} stalled` : '✅ All clear'}
                            </p>
                        </div>
                    </div>

                    <div class="grid grid-cols-2 gap-3 mb-3">
                        <div class="bg-gradient-to-br from-blue-50 to-blue-100 border border-blue-200 p-3 rounded-xl text-center">
                            <div class="text-[9px] text-blue-700 font-bold uppercase tracking-wider">Active</div>
                            <div class="text-4xl font-black text-blue-700 leading-none mt-1">${a.active}</div>
                        </div>
                        <div class="bg-gradient-to-br from-teal-50 to-teal-100 border border-teal-200 p-3 rounded-xl text-center">
                            <div class="text-[9px] text-teal-700 font-bold uppercase tracking-wider leading-tight">Approved<br>Not Completed</div>
                            <div class="text-4xl font-black text-teal-700 leading-none mt-1">${a.approvedNotCompleted}</div>
                        </div>
                    </div>

                    <div class="flex justify-between gap-1 text-[10px] bg-slate-50 p-2 rounded-lg border border-slate-100">
                        <div class="flex flex-col items-center">
                            <span class="text-gray-400 uppercase font-bold text-[8px]">Total</span>
                            <span class="text-xs font-bold text-slate-700">${a.total}</span>
                        </div>
                        <div class="flex flex-col items-center">
                            <span class="text-gray-400 uppercase font-bold text-[8px]">Done</span>
                            <span class="text-xs font-bold text-green-600">${a.completed}</span>
                        </div>
                        <div class="flex flex-col items-center">
                            <span class="text-gray-400 uppercase font-bold text-[8px]">Aband.</span>
                            <span class="text-xs font-bold text-gray-500">${a.abandoned}</span>
                        </div>
                        <div class="flex flex-col items-center">
                            <span class="text-gray-400 uppercase font-bold text-[8px]">Stalled</span>
                            <span class="text-xs font-bold ${hasStalled ? 'text-red-600' : 'text-gray-400'}">${a.stalled}</span>
                        </div>
                        <div class="flex flex-col items-center">
                            <span class="text-gray-400 uppercase font-bold text-[8px]">Cycle</span>
                            <span class="text-xs font-bold text-teal-600">${a.avgCycleTime != null ? a.avgCycleTime.toFixed(1) + 'h' : '—'}</span>
                        </div>
                    </div>

                    <div class="mt-3 pt-2 border-t border-gray-100 text-center text-[10px] font-bold text-google-blue">View Details →</div>
                </div>
            `;
        }).join('');

        container.innerHTML = summaryHtml + `<div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">${cardsHtml}</div>`;
    },

    showAreaPRDetails(encodedAreaName) {
        const areaName = decodeURIComponent(encodedAreaName);
        const stats = this.calculatePRStatsByArea();
        const areaStats = stats.find(a => a.area === areaName);
        if (!areaStats) return;

        const modal = document.getElementById('story-modal');
        const title = document.getElementById('modal-title');
        const body = document.getElementById('modal-body');
        title.innerText = `🔀 ${areaName} — ${areaStats.total} PRs`;

        const statusMap = {
            active:    { label: 'Active',    cls: 'bg-blue-100 text-blue-700 border-blue-300' },
            completed: { label: 'Completed', cls: 'bg-green-100 text-green-700 border-green-300' },
            abandoned: { label: 'Abandoned', cls: 'bg-gray-100 text-gray-600 border-gray-300' },
            unknown:   { label: 'Unknown',   cls: 'bg-slate-100 text-slate-500 border-slate-300' }
        };
        const statusOrder = { active: 0, completed: 1, abandoned: 2, unknown: 3 };
        const now = Date.now();
        const THREE_DAYS = 3 * 24 * 60 * 60 * 1000;

        const enriched = areaStats.prs.map(pr => {
            const hasApproval = (pr.reviewers || []).some(r => r.vote >= 5);
            const createdMs = pr.creationDate ? new Date(pr.creationDate).getTime() : 0;
            const ageDays = createdMs ? Math.floor((now - createdMs) / (1000 * 60 * 60 * 24)) : null;
            const isStalled = pr.status === 'active' && createdMs > 0 && (now - createdMs) >= THREE_DAYS && !hasApproval;
            const isApprovedPending = pr.status === 'active' && hasApproval;
            return { ...pr, hasApproval, ageDays, isStalled, isApprovedPending, _createdMs: createdMs };
        }).sort((a, b) => {
            if (a.isStalled !== b.isStalled) return a.isStalled ? -1 : 1;
            if (a.isApprovedPending !== b.isApprovedPending) return a.isApprovedPending ? -1 : 1;
            const sa = statusOrder[a.status] ?? 3;
            const sb = statusOrder[b.status] ?? 3;
            if (sa !== sb) return sa - sb;
            return b._createdMs - a._createdMs;
        });

        const summaryBar = `
            <div class="grid grid-cols-2 gap-3 mb-3">
                <div class="bg-gradient-to-br from-blue-100 to-blue-200 p-4 rounded-xl text-center">
                    <div class="text-[10px] text-blue-700 font-bold uppercase tracking-wider">Active</div>
                    <div class="text-4xl font-black text-blue-700 leading-none mt-1">${areaStats.active}</div>
                </div>
                <div class="bg-gradient-to-br from-teal-100 to-teal-200 p-4 rounded-xl text-center">
                    <div class="text-[10px] text-teal-700 font-bold uppercase tracking-wider">Approved · Not Completed</div>
                    <div class="text-4xl font-black text-teal-700 leading-none mt-1">${areaStats.approvedNotCompleted}</div>
                </div>
            </div>
            <div class="grid grid-cols-2 md:grid-cols-5 gap-2 mb-4 text-xs">
                <div class="bg-slate-50 p-2 rounded text-center"><div class="text-[9px] text-slate-500 font-bold uppercase">Total</div><div class="text-sm font-bold text-slate-700">${areaStats.total}</div></div>
                <div class="bg-slate-50 p-2 rounded text-center"><div class="text-[9px] text-slate-500 font-bold uppercase">Completed</div><div class="text-sm font-bold text-green-600">${areaStats.completed}</div></div>
                <div class="bg-slate-50 p-2 rounded text-center"><div class="text-[9px] text-slate-500 font-bold uppercase">Approved</div><div class="text-sm font-bold text-teal-600">${areaStats.approved}</div></div>
                <div class="bg-slate-50 p-2 rounded text-center"><div class="text-[9px] text-slate-500 font-bold uppercase">Abandoned</div><div class="text-sm font-bold text-gray-500">${areaStats.abandoned}</div></div>
                <div class="bg-slate-50 p-2 rounded text-center"><div class="text-[9px] text-slate-500 font-bold uppercase">Stalled</div><div class="text-sm font-bold ${areaStats.stalled > 0 ? 'text-red-600' : 'text-gray-400'}">${areaStats.stalled}</div></div>
            </div>
            <div class="flex justify-between items-center text-xs bg-slate-50 p-2 rounded mb-4">
                <span class="font-bold text-slate-600">⏱ Avg Cycle Time:</span>
                <span class="font-mono font-bold text-teal-700">${areaStats.avgCycleTime != null ? areaStats.avgCycleTime.toFixed(1) + 'h' : '—'}</span>
            </div>
        `;

        const prsHtml = enriched.map(pr => {
            const cfg = statusMap[pr.status] || statusMap.unknown;
            const created = pr.creationDate ? new Date(pr.creationDate).toLocaleDateString('en-GB') : '—';
            const cycle = pr.cycleTimeHours != null ? pr.cycleTimeHours.toFixed(1) + 'h' : '—';
            const cardBg = pr.isStalled ? 'bg-red-50 border-red-300'
                : pr.isApprovedPending ? 'bg-teal-50 border-teal-300'
                : 'bg-white border-gray-200';
            return `
                <div class="p-3 border rounded-lg mb-2 ${cardBg}">
                    <div class="flex justify-between items-start gap-2">
                        <div class="flex-1 min-w-0">
                            <div class="flex items-center gap-2 flex-wrap">
                                <span class="font-mono font-bold text-indigo-600">#${pr.id}</span>
                                <span class="px-2 py-0.5 rounded text-[10px] font-bold border ${cfg.cls}">${cfg.label}</span>
                                ${pr.isStalled ? `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-red-500 text-white">⚠️ STALLED ${pr.ageDays}d</span>` : ''}
                                ${pr.isApprovedPending ? `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-teal-500 text-white">✅ READY TO MERGE</span>` : ''}
                                ${pr.hasApproval && !pr.isApprovedPending ? '<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-green-100 text-green-700 border border-green-300">👍 Approved</span>' : ''}
                            </div>
                            <div class="text-sm font-medium text-slate-700 mt-1 break-words">${escapeHtml(pr.title)}</div>
                            <div class="text-[11px] text-gray-500 mt-1">
                                By ${escapeHtml(pr.createdBy)} · Repo: ${escapeHtml(pr.repository)} · Story: #${pr.linkedStoryId || 'N/A'}
                            </div>
                            ${pr.reviewers && pr.reviewers.length > 0 ? `
                                <div class="text-[11px] text-gray-500 mt-0.5">
                                    👥 ${pr.reviewers.map(r => `${escapeHtml(r.name)} (${r.vote >= 5 ? '✅' : r.vote <= -5 ? '❌' : '⏳'})`).join(' · ')}
                                </div>
                            ` : ''}
                        </div>
                        <div class="text-right shrink-0">
                            <div class="text-[10px] text-gray-400 uppercase font-bold">Created</div>
                            <div class="text-xs font-bold text-slate-700">${created}</div>
                            <div class="text-[10px] text-gray-400 uppercase font-bold mt-1">Cycle</div>
                            <div class="text-xs font-mono font-bold ${pr.cycleTimeHours != null ? 'text-teal-700' : 'text-gray-400'}">${cycle}</div>
                        </div>
                    </div>
                </div>
            `;
        }).join('');

        body.innerHTML = summaryBar + (prsHtml || '<div class="text-center py-10 text-gray-400">No PRs in this area.</div>');
        modal.classList.remove('hidden');
        document.body.style.overflow = 'hidden';
    },

    // =================================================================
    // DASHBOARD
    // =================================================================
    renderDashboard() {
        const container = document.getElementById('dashboard-container');
        if (!container) return;

        const nonBacklogData = currentData.filter(s => !isBacklogStory(s) && isRegularStory(s));
        const activeStories = nonBacklogData.filter(s => s.state !== 'Tested' && s.state !== 'Closed');
        const activeDevsSet = new Set();
        const activeTestersSet = new Set();
        activeStories.forEach(s => {
            if (s.assignedTo && s.assignedTo !== "Unassigned") activeDevsSet.add(s.assignedTo);
            if (s.tester && s.tester !== "Unassigned") activeTestersSet.add(s.tester);
        });
        const freeDevs = this.getFreeStaff('dev');
        const freeTesters = this.getFreeStaff('tester');

        const staffStatsHtml = `
            <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                <div onclick="ui.showStaffDetails('dev', 'active')" class="bg-gradient-to-br from-blue-100 to-blue-200 p-4 rounded-2xl shadow-lg text-slate-800 cursor-pointer hover:scale-105 transition-transform">
                    <div class="text-[10px] opacity-80 font-bold uppercase tracking-wider">Active Developers</div>
                    <div class="text-4xl font-black mt-1">${activeDevsSet.size}</div>
                    <div class="text-[10px] mt-2 bg-white/50 inline-block px-2 py-0.5 rounded">Click for details</div>
                </div>
                <div onclick="ui.showStaffDetails('tester', 'active')" class="bg-gradient-to-br from-green-100 to-green-200 p-4 rounded-2xl shadow-lg text-slate-800 cursor-pointer hover:scale-105 transition-transform">
                    <div class="text-[10px] opacity-80 font-bold uppercase tracking-wider">Active Testers</div>
                    <div class="text-4xl font-black mt-1">${activeTestersSet.size}</div>
                    <div class="text-[10px] mt-2 bg-white/50 inline-block px-2 py-0.5 rounded">Click for details</div>
                </div>
                <div onclick="ui.showStaffDetails('dev', 'free')" class="bg-gradient-to-br from-slate-100 to-slate-200 p-4 rounded-2xl shadow-lg text-slate-800 cursor-pointer hover:scale-105 transition-transform">
                    <div class="text-[10px] opacity-80 font-bold uppercase tracking-wider">Free Developers</div>
                    <div class="text-4xl font-black mt-1">${freeDevs.length}</div>
                    <div class="text-[10px] mt-2 bg-white/50 inline-block px-2 py-0.5 rounded">Click for details</div>
                </div>
                <div onclick="ui.showStaffDetails('tester', 'free')" class="bg-gradient-to-br from-purple-100 to-purple-200 p-4 rounded-2xl shadow-lg text-slate-800 cursor-pointer hover:scale-105 transition-transform">
                    <div class="text-[10px] opacity-80 font-bold uppercase tracking-wider">Free Testers</div>
                    <div class="text-4xl font-black mt-1">${freeTesters.length}</div>
                    <div class="text-[10px] mt-2 bg-white/50 inline-block px-2 py-0.5 rounded">Click for details</div>
                </div>
            </div>
        `;

        const prStats = this.calculatePRStats();
        const prStatsHtml = `
            <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                <div class="bg-gradient-to-br from-indigo-100 to-indigo-200 p-4 rounded-2xl shadow-lg text-slate-800">
                    <div class="text-[10px] opacity-80 font-bold uppercase tracking-wider">Total Pull Requests</div>
                    <div class="text-4xl font-black mt-1">${prStats.total}</div>
                    <div class="text-[10px] mt-2 bg-white/50 inline-block px-2 py-0.5 rounded">
                        ${prStats.active} active · ${prStats.completed} completed · ${prStats.abandoned} abandoned
                    </div>
                </div>
                <div class="bg-gradient-to-br from-teal-100 to-teal-200 p-4 rounded-2xl shadow-lg text-slate-800">
                    <div class="text-[10px] opacity-80 font-bold uppercase tracking-wider">Avg PR Cycle Time</div>
                    <div class="text-4xl font-black mt-1">${prStats.avgCycleTime.toFixed(1)}h</div>
                    <div class="text-[10px] mt-2 bg-white/50 inline-block px-2 py-0.5 rounded">
                        Across ${prStats.completed} completed PRs
                    </div>
                </div>
                <div onclick="ui.showStalePRs()" 
                     class="bg-gradient-to-br ${prStats.stalePRs.length > 0 ? 'from-red-100 to-red-200' : 'from-slate-100 to-slate-200'} p-4 rounded-2xl shadow-lg text-slate-800 cursor-pointer hover:scale-105 transition-transform">
                    <div class="text-[10px] opacity-80 font-bold uppercase tracking-wider">Stale PRs (&gt;3 days, no approval)</div>
                    <div class="text-4xl font-black mt-1">${prStats.stalePRs.length}</div>
                    <div class="text-[10px] mt-2 bg-white/50 inline-block px-2 py-0.5 rounded">Click for details</div>
                </div>
            </div>
        `;

        const areaStateMap = {};
        const allStates = new Set();
        nonBacklogData.forEach(s => {
            const area = s.area || 'General';
            const state = s.state || 'Unknown';
            allStates.add(state);
            if (!areaStateMap[area]) areaStateMap[area] = {};
            areaStateMap[area][state] = (areaStateMap[area][state] || 0) + 1;
        });
        const sortedStates = Array.from(allStates).sort();
        const stateTotals = {};
        sortedStates.forEach(st => { stateTotals[st] = 0; });

        let areaStatsHtml = `
            <div class="card p-6">
                <h3 class="font-bold text-slate-700 mb-4 flex items-center gap-2">📊 Business Area Stats (By State)</h3>
                <div class="overflow-x-auto">
                    <table class="w-full text-sm">
                        <thead><tr class="bg-gray-50 border-b">
                            <th class="text-left p-2 font-bold text-gray-600">Business Area</th>
                            ${sortedStates.map(state => `<th class="text-center p-2 font-bold text-gray-600">${escapeHtml(state)}</th>`).join('')}
                            <th class="text-center p-2 font-bold text-google-blue">Total</th>
                        </tr></thead>
                        <tbody>
        `;
        let grandTotal = 0;
        const sortedAreas = Object.keys(areaStateMap).sort();
        sortedAreas.forEach(area => {
            const statesData = areaStateMap[area];
            let rowTotal = 0;
            const rowCells = sortedStates.map(state => {
                const count = statesData[state] || 0;
                rowTotal += count;
                stateTotals[state] += count;
                return `<td class="text-center p-2 border-t">${count}</td>`;
            }).join('');
            grandTotal += rowTotal;
            areaStatsHtml += `<tr class="border-b hover:bg-gray-50">
                <td class="p-2 font-medium text-slate-700">${escapeHtml(area)}</td>
                ${rowCells}
                <td class="text-center p-2 border-t font-bold text-google-blue">${rowTotal}</td>
            </tr>`;
        });
        areaStatsHtml += `
                    <tr class="bg-gray-100 font-bold">
                        <td class="p-2 text-slate-800">Grand Total</td>
                        ${sortedStates.map(state => `<td class="text-center p-2">${stateTotals[state]}</td>`).join('')}
                        <td class="text-center p-2 text-google-blue">${grandTotal}</td>
                    </tr>
                </tbody></table></div></div>`;

        const branchMap = {};
        const customerMap = {};
        activeStories.forEach(s => {
            const branch = s.branch || 'N/A';
            branchMap[branch] = (branchMap[branch] || 0) + 1;
            const customer = s.customer || 'General';
            customerMap[customer] = (customerMap[customer] || 0) + 1;
        });

        const sortedBranches = Object.entries(branchMap).sort((a, b) => b[1] - a[1]);
        const branchStatsHtml = `
            <div class="card p-6">
                <h3 class="font-bold text-slate-700 mb-4 flex items-center gap-2">🌿 Active Stories by Branch</h3>
                <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
                    ${sortedBranches.map(([branch, count]) => `
                        <div class="bg-google-blue-light p-3 rounded-lg border border-google-blue/20 text-center cursor-pointer hover:bg-google-blue/20 transition" onclick="ui.showBranchModal('${encodeURIComponent(branch)}')">
                            <div class="text-xs font-bold text-google-blue truncate" title="${escapeHtml(branch)}">${escapeHtml(branch)}</div>
                            <div class="text-2xl font-black text-google-blue">${count}</div>
                        </div>
                    `).join('')}
                </div>
                <div class="mt-2 text-xs text-gray-400">Total Active Stories: ${activeStories.length}</div>
            </div>
        `;

        const sortedCustomers = Object.entries(customerMap).sort((a, b) => b[1] - a[1]);
        const customerStatsHtml = `
            <div class="card p-6">
                <h3 class="font-bold text-slate-700 mb-4 flex items-center gap-2">👥 Active Stories by Customer</h3>
                <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
                    ${sortedCustomers.map(([customer, count]) => `
                        <div class="bg-google-green-light p-3 rounded-lg border border-google-green/20 text-center cursor-pointer hover:bg-google-green/20 transition" onclick="ui.showCustomerModal('${encodeURIComponent(customer)}')">
                            <div class="text-xs font-bold text-google-green truncate" title="${escapeHtml(customer)}">${escapeHtml(customer)}</div>
                            <div class="text-2xl font-black text-google-green">${count}</div>
                        </div>
                    `).join('')}
                </div>
                <div class="mt-2 text-xs text-gray-400">Total Active Stories: ${activeStories.length}</div>
            </div>
        `;

        const regularCurrent = currentData.filter(isRegularStory);
        const allStoriesForRoadmap = [...regularCurrent, ...db.backlogStories];
        const roadmapHtml = this.renderClientRoadmap(allStoriesForRoadmap);

        container.innerHTML = `
            ${staffStatsHtml}
            ${prStatsHtml}
            ${areaStatsHtml}
            <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
                ${branchStatsHtml}
                ${customerStatsHtml}
            </div>
            <div class="mt-6">${roadmapHtml}</div>
        `;
    },

    renderClientRoadmap(stories = []) {
        const today = new Date();
        const twoMonthsLater = new Date();
        twoMonthsLater.setMonth(twoMonthsLater.getMonth() + CONFIG.BACKLOG_MONTHS);

        const upcomingDeliveries = stories.filter(s => {
            if (s.expectedRelease && typeof s.expectedRelease === 'string') {
                s.expectedRelease = new Date(s.expectedRelease);
            }
            if (!s.expectedRelease || !(s.expectedRelease instanceof Date)) return false;
            const isNotDone = s.state !== 'Tested' && s.state !== 'Closed';
            return isNotDone && s.expectedRelease >= today && s.expectedRelease <= twoMonthsLater;
        }).sort((a, b) => a.expectedRelease - b.expectedRelease);

        let html = `
            <div class="card p-6">
                <h3 class="font-bold text-google-blue mb-4 flex items-center gap-2">
                    🚀 Client Delivery Roadmap (Next ${CONFIG.BACKLOG_MONTHS} Months)
                    <span class="text-xs font-normal text-gray-400 ml-2">(${upcomingDeliveries.length} items)</span>
                </h3>
                <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        `;
        if (upcomingDeliveries.length === 0) {
            html += `<div class="col-span-full text-center py-8 text-gray-400">No client deliveries expected in the next ${CONFIG.BACKLOG_MONTHS} months.</div>`;
        } else {
            html += upcomingDeliveries.map(s => {
                const diffDays = Math.ceil(Math.abs(s.expectedRelease - today) / (1000 * 60 * 60 * 24));
                let urgencyClass = "border-google-blue/30 bg-white";
                if (diffDays <= 7) urgencyClass = "border-google-yellow bg-google-yellow-light";
                if (diffDays <= 3) urgencyClass = "border-google-red bg-google-red-light";
                const isBacklog = isBacklogStory(s) ? '📋 ' : '';
                return `
                    <div class="card p-4 border-2 ${urgencyClass} ${isBacklogStory(s) ? 'border-dashed' : ''}">
                        <div class="flex justify-between items-start mb-2">
                            <span class="text-[10px] font-bold text-google-blue bg-google-blue-light px-2 py-0.5 rounded">In ${diffDays} Days</span>
                            <div class="flex items-center gap-2">
                                <span class="text-[10px] font-bold text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded">P${escapeHtml(s.priority || '?')}</span>
                                <span class="text-[10px] text-gray-400">#${s.id}</span>
                            </div>
                        </div>
                        <div class="text-sm font-bold text-slate-800 truncate" title="${escapeHtml(s.title)}">${isBacklog}${escapeHtml(s.title)}</div>
                        <div class="text-[11px] text-gray-500 mt-1">Area: ${escapeHtml(s.area)}</div>
                        ${isBacklogStory(s) ? '<div class="text-[10px] text-purple-600 font-bold mt-1">📋 Backlog</div>' : ''}
                        <div class="mt-3 flex justify-between items-center">
                            <div class="text-[10px] font-bold uppercase text-gray-400">Release:</div>
                            <div class="text-xs font-bold text-slate-700">${s.expectedRelease.toLocaleDateString('en-GB')}</div>
                        </div>
                        <div class="mt-2 h-1 w-full bg-gray-100 rounded-full overflow-hidden">
                            <div class="h-full ${isBacklogStory(s) ? 'bg-purple-400' : 'bg-google-blue'}" style="width: ${s.state === 'Resolved' ? '80%' : '40%'}"></div>
                        </div>
                    </div>
                `;
            }).join('');
        }
        html += `</div></div>`;
        return html;
    },

    getFreeStaff(role) {
        const allStories = currentData.filter(s => !isBacklogStory(s));
        const allStaff = new Set();
        const busyStaff = new Set();

        allStories.forEach(s => {
            if (role === 'dev' && s.assignedTo && s.assignedTo !== "Unassigned") allStaff.add(s.assignedTo);
            else if (role === 'tester' && s.tester && s.tester !== "Unassigned") allStaff.add(s.tester);

            (s.tasks || []).forEach(t => {
                if (t['State'] !== 'To Be Reviewed' && t['State'] !== 'Closed' && parseFloat(t['Original Estimation'] || 0) > 0) {
                    const worker = (t['Activity'] === 'Testing') ? s.tester : s.assignedTo;
                    if (worker && worker !== "Unassigned") busyStaff.add(worker);
                }
            });

            if (s.type === 'Support log' && s.state !== 'Tested' && s.state !== 'Closed') {
                if (role === 'dev' && s.assignedTo && s.assignedTo !== "Unassigned") busyStaff.add(s.assignedTo);
                if (role === 'tester' && s.tester && s.tester !== "Unassigned") busyStaff.add(s.tester);
            }

            if (s.bugs && s.bugs.length > 0) {
                s.bugs.forEach(bug => {
                    if (['New', 'Active'].includes(bug['State'])) {
                        const worker = bug['Assigned To'];
                        if (worker && worker !== "Unassigned") busyStaff.add(worker);
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
            const regularNonBacklog = currentData.filter(s => !isBacklogStory(s) && isRegularStory(s) && s.state !== 'Tested' && s.state !== 'Closed');
            const html = list.map(name => {
                if (showStoryCount) {
                    let count = 0;
                    if (title.includes('Developers')) {
                        count = regularNonBacklog.filter(s => s.assignedTo === name).length;
                    } else if (title.includes('Testers')) {
                        count = regularNonBacklog.filter(s => s.tester === name).length;
                    }
                    return `
                        <div class="flex justify-between items-center bg-slate-50 p-3 rounded-xl border border-slate-100">
                            <span class="font-bold text-slate-700">${escapeHtml(name)}</span>
                            <span class="bg-google-blue-light text-google-blue px-3 py-1 rounded-full text-xs font-bold">${count} Stories</span>
                        </div>
                    `;
                }
                return `
                    <div class="flex justify-between items-center bg-slate-50 p-3 rounded-xl border border-slate-100">
                        <span class="font-bold text-slate-700">${escapeHtml(name)}</span>
                        <span class="bg-google-green-light text-google-green px-3 py-1 rounded-full text-xs font-bold">Free</span>
                    </div>
                `;
            }).join('');
            body.innerHTML = `<div class="space-y-3">${html}</div>`;
        }
        modal.classList.remove('hidden');
        document.body.style.overflow = 'hidden';
    },

    showStaffDetails(role, type) {
        if (type === 'active') {
            const set = new Set();
            currentData.forEach(s => {
                if (!isBacklogStory(s) && isRegularStory(s) && s.state !== 'Tested' && s.state !== 'Closed') {
                    if (role === 'dev' && s.assignedTo && s.assignedTo !== "Unassigned") set.add(s.assignedTo);
                    else if (role === 'tester' && s.tester && s.tester !== "Unassigned") set.add(s.tester);
                }
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

    // =================================================================
    // ACTIVE CARDS
    // =================================================================
    renderActiveCards() {
        const container = document.getElementById('active-cards-container');
        if (!container) return;
        const searchTerm = document.getElementById('search-input')?.value.toLowerCase() || "";
        const tagSearchTerm = document.getElementById('tag-search-input')?.value.toLowerCase() || "";

        const activeStories = currentData.filter(s => {
            if (isBacklogStory(s) || !isRegularStory(s)) return false;
            if (s.state === 'Tested' || s.state === 'Closed') return false;
            const matchesSearch = !searchTerm ||
                s.title.toLowerCase().includes(searchTerm) ||
                s.id.toString().includes(searchTerm) ||
                s.tester.toLowerCase().includes(searchTerm) ||
                s.assignedTo.toLowerCase().includes(searchTerm) ||
                (s.area && s.area.toLowerCase().includes(searchTerm));
            const matchesTags = tagSearchTerm === "" || (s.customTags && s.customTags.some(tag => tag.toLowerCase().includes(tagSearchTerm)));
            return matchesSearch && matchesTags;
        });

        if (activeStories.length === 0) {
            container.innerHTML = `<div class="col-span-full text-center py-20 text-gray-400">${searchTerm ? 'لا توجد نتائج تطابق بحثك.' : 'No active stories found.'}</div>`;
            return;
        }

        const groupedStories = activeStories.reduce((groups, story) => {
            const area = story.area || "General";
            if (!groups[area]) groups[area] = [];
            groups[area].push(story);
            return groups;
        }, {});

        const now = new Date();
        const nowMs = now.getTime();

        container.innerHTML = Object.keys(groupedStories).map(area => {
            const storiesInArea = groupedStories[area].sort((a, b) => {
                if (a.priority !== b.priority) return a.priority - b.priority;
                const isALate = a.calc.finalEnd instanceof Date && nowMs > a.calc.finalEnd.getTime();
                const isBLate = b.calc.finalEnd instanceof Date && nowMs > b.calc.finalEnd.getTime();
                return isBLate - isALate;
            });

            return `
                <div class="col-span-full mt-8 mb-4">
                    <h2 class="text-xl font-bold text-slate-700 flex items-center gap-2">
                        <span class="w-2 h-6 bg-google-blue rounded-full"></span>
                        ${escapeHtml(area)} 
                        <span class="text-sm font-normal text-gray-400">(${storiesInArea.length})</span>
                    </h2>
                </div>
                ${storiesInArea.map(s => {
                    const isLate = s.calc.finalEnd instanceof Date && now > s.calc.finalEnd;
                    const hasError = s.calc.error;
                    const devTasks = s.tasks.filter(t => ["Development", "DB Modification"].includes(t['Activity']));
                    const totalDevEffort = devTasks.reduce((acc, t) => acc + parseFloat(t['Original Estimation'] || 0), 0);
                    const devActivatedDates = devTasks.map(t => t['Activated Date']).filter(Boolean).sort();
                    const activeDaysCount = devActivatedDates.length > 0 ? dateEngine.countWorkDaysUntilNow(devActivatedDates[0], s.assignedTo) : 0;

                    let activeDaysColor = "bg-google-green";
                    if (activeDaysCount >= 7 && activeDaysCount <= 12) activeDaysColor = "bg-google-yellow";
                    else if (activeDaysCount > 12) activeDaysColor = "bg-google-red shadow-google-red/20 animate-pulse";

                    const devVacDaysNow = devActivatedDates.length > 0 ? dateEngine.countVacationDaysUntilNow(devActivatedDates[0], s.assignedTo) : 0;
                    const devStartDisplay = devActivatedDates.length > 0 ? new Date(devActivatedDates[0]).toLocaleDateString('en-GB') : "TBD";
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
                    const testVacDaysNow = (execTask && execTask['Activated Date']) ? dateEngine.countVacationDaysUntilNow(execTask['Activated Date'], s.tester) : 0;
                    if (execTask && execTask['Activated Date']) testStartDisplay = new Date(execTask['Activated Date']).toLocaleDateString('en-GB');

                    const isDevLate = s.calc.devEnd instanceof Date && now > s.calc.devEnd && (s.state !== 'Resolved' && s.state !== 'Tested' && s.state !== 'Closed');
                    const devLightColor = (s.state === 'Resolved' || s.state === 'Tested' || s.state === 'Closed') ? 'bg-google-green shadow-[0_0_8px_rgba(34,197,94,0.6)]' : (isDevLate ? 'bg-google-red animate-pulse shadow-[0_0_8px_rgba(239,68,68,0.6)]' : 'bg-gray-300');
                    const isTestLate = s.calc.testEnd instanceof Date && now > s.calc.testEnd && (s.state !== 'Tested' && s.state !== 'Closed');
                    const testLightColor = (s.state === 'Tested' || s.state === 'Closed') ? 'bg-google-green shadow-[0_0_8px_rgba(34,197,94,0.6)]' : (isTestLate ? 'bg-google-red animate-pulse shadow-[0_0_8px_rgba(239,68,68,0.6)]' : 'bg-gray-300');

                    const nonTestTasks = s.tasks.filter(t => t['Activity'] !== 'Testing' && t['Activity'] !== 'Preparation');
                    const totalDevTasks = nonTestTasks.length;
                    const completedDevTasks = nonTestTasks.filter(t => ['Closed', 'To Be Reviewed', 'Resolved'].includes(t['State'])).length;
                    const devProgressPercent = totalDevTasks > 0 ? Math.round((completedDevTasks / totalDevTasks) * 100) : 0;

                    const totalBugs = s.bugs ? s.bugs.length : 0;
                    const completedBugs = s.bugs ? s.bugs.filter(b => ['Closed', 'Resolved'].includes(b['State'])).length : 0;
                    const totalBugEffort = s.bugs ? s.bugs.reduce((acc, b) => acc + parseFloat(b['Original Estimation'] || 0), 0) : 0;
                    const completedBugEffort = s.bugs ? s.bugs.filter(b => ['Closed', 'Resolved'].includes(b['State'])).reduce((acc, b) => acc + parseFloat(b['Original Estimation'] || 0), 0) : 0;
                    const remainingBugEffort = Math.max(0, totalBugEffort - completedBugEffort);
                    const bugProgressPercent = totalBugEffort > 0 ? Math.round((completedBugEffort / totalBugEffort) * 100) : 0;

                    const testCases = s.testCases || [];
                    const totalTC = testCases.length;
                    const completedTC = testCases.filter(tc => ['Pass', 'Fail', 'Not Applicable'].includes(tc.state)).length;
                    const progressPercent = totalTC > 0 ? Math.round((completedTC / totalTC) * 100) : 0;

                    const statusColor = isLate ? "status-delayed" : (hasError ? "bg-amber-100 text-amber-700" : "status-active");
                    const statusText = isLate ? `Overdue ⚠️ (${s.state})` : s.state;

                    const tagDropdownHtml = renderTagDropdown(s.id, s.customTags || []);
                    const commentsHtml = renderComments(s);

                    return `
                    <div class="card relative p-5 border-gray-100 hover:border-google-blue transition-all overflow-visible mb-4">
                        ${activeDaysCount > 0 ? `
                            <div class="absolute top-0 right-0 mt-8 mr-4 flex flex-col items-center justify-center ${activeDaysColor} text-slate-800 w-14 h-14 rounded-xl shadow-lg transform rotate-3 z-10 transition-colors duration-500">
                                <span class="text-xl font-black leading-none">${activeDaysCount}</span>
                                <span class="text-[8px] uppercase font-bold">Days</span>
                            </div>
                        ` : ''}
                        <div class="flex-1">
                            <div class="flex justify-between items-start mb-4">
                                <div class="flex gap-2">
                                    <span class="status-badge ${statusColor}">${escapeHtml(statusText)}</span>
                                    <span class="px-2 py-0.5 rounded bg-gray-100 text-[10px] font-bold text-gray-600">P${escapeHtml(s.priority || 999)}</span>
                                </div>
                                <span onclick="ui.openStoryModal('${s.id}')" class="text-xs font-mono text-gray-400 cursor-pointer hover:text-google-blue">#${s.id} 🔍</span>
                            </div>
                            <div class="flex flex-wrap gap-1 mt-2 mb-3">
                                ${s.tags.map(t => `<span class="px-2 py-0.5 bg-google-red-light text-google-red border border-google-red/30 rounded text-[10px] font-semibold">${escapeHtml(t)}</span>`).join('')}
                            </div>
                            <div class="flex flex-wrap items-center gap-1.5 mb-4 border-b border-dashed border-gray-100 pb-3 overflow-visible">
                                ${(s.customTags || []).map(tag => `
                                    <span class="inline-flex items-center gap-1 px-2 py-1 bg-purple-100 text-purple-700 border border-purple-200 rounded-md text-[10px] font-bold">
                                        ${escapeHtml(tag)}
                                        <button onclick="tagManager.toggleTagInStory('${s.id}', '${encodeURIComponent(tag)}')" class="hover:text-purple-900 font-black ml-1">×</button>
                                    </span>
                                `).join('')}
                                ${tagDropdownHtml}
                            </div>
                            <h3 onclick="ui.openStoryModal('${s.id}')" class="text-lg font-bold text-slate-800 mb-1 leading-tight cursor-pointer">${escapeHtml(s.title)}</h3>
                            <div class="grid grid-cols-2 gap-4 py-4 border-t border-gray-50 mt-4">
                                <div>
                                    <div class="flex items-center gap-2 mb-1">
                                        <div class="w-2.5 h-2.5 rounded-full ${devLightColor}"></div>
                                        <p class="text-[10px] uppercase text-gray-400 font-bold">Development</p>
                                    </div>
                                    <div class="flex flex-col gap-0.5">
                                        <p class="text-sm font-medium text-slate-700 flex items-center gap-2">
                                            <span class="w-6 h-6 rounded-full bg-slate-100 flex items-center justify-center text-[10px]">🛠</span> ${escapeHtml(s.assignedTo)}
                                        </p>
                                        <div class="ml-8 mt-1">
                                            <div class="flex justify-between items-center mb-0.5">
                                                <span class="text-[9px] text-gray-400 font-bold">Tasks: ${completedDevTasks}/${totalDevTasks}</span>
                                                <span class="text-[9px] text-google-blue font-bold">${devProgressPercent}%</span>
                                            </div>
                                            <div class="w-full bg-gray-100 h-1 rounded-full overflow-hidden mb-1">
                                                <div class="h-full" style="width: ${devProgressPercent}%; background-color: #3b82f6;"></div>
                                            </div>
                                            ${totalBugs > 0 ? `
                                            <div class="mb-1">
                                                <div class="flex justify-between items-center mb-0.5">
                                                    <span class="text-[9px] text-gray-400 font-bold">Bugs: ${completedBugs}/${totalBugs}</span>
                                                    <span class="text-[9px] text-google-red font-bold">${bugProgressPercent}%</span>
                                                </div>
                                                <div class="w-full bg-gray-100 h-1 rounded-full overflow-hidden">
                                                    <div class="h-full" style="width: ${bugProgressPercent}%; background-color: #ef4444;"></div>
                                                </div>
                                                ${totalBugEffort > 0 ? `
                                                <div class="flex justify-between items-center mt-1 text-[10px] text-gray-500">
                                                    <span class="font-bold">Bug Effort:</span>
                                                    <span class="font-mono">${remainingBugEffort.toFixed(1)}/${totalBugEffort.toFixed(1)}h</span>
                                                    <span class="text-xs font-bold ${remainingBugEffort === 0 ? 'text-google-green' : 'text-amber-600'}">${bugProgressPercent}%</span>
                                                </div>
                                                ` : ''}
                                            </div>
                                            ` : ''}
                                            <p class="text-[10px] text-gray-500 mt-1 font-medium">Start: ${escapeHtml(devStartDisplay)}</p>
                                            ${devVacDaysNow > 0 ? `<p class="text-[10px] text-orange-600 font-bold">🏖 Vac (Now): ${devVacDaysNow} Days</p>` : ''}
                                            <p class="text-[10px] text-google-green font-bold">Resolved: ${escapeHtml(devResolveDate)}</p>
                                            <p class="text-[10px] text-google-blue font-bold">Est: ${totalDevEffort}h</p>
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
                                            <span class="w-6 h-6 rounded-full bg-slate-100 flex items-center justify-center text-[10px]">🔍</span> ${escapeHtml(s.tester)}
                                        </p>
                                        <div class="ml-8 mt-1">
                                            <div class="flex justify-between items-center mb-0.5">
                                                <span class="text-[9px] text-gray-400 font-bold">TCs: ${completedTC}/${totalTC}</span>
                                                <span class="text-[9px] text-google-blue font-bold">${progressPercent}%</span>
                                            </div>
                                            <div class="w-full bg-gray-100 h-1 rounded-full overflow-hidden mb-1">
                                                <div class="h-full" style="width: ${progressPercent}%; background-color: #3b82f6;"></div>
                                            </div>
                                            <p class="text-[10px] text-gray-500 mt-1 font-medium">Start: ${escapeHtml(testStartDisplay)}</p>
                                            ${testVacDaysNow > 0 ? `<p class="text-[10px] text-orange-600 font-bold">🏖 Vac (Now): ${testVacDaysNow} Days</p>` : ''}
                                            <p class="text-[10px] text-google-blue font-bold">Est QA: ${totalTestEffort}h</p>
                                        </div>
                                    </div>
                                </div>
                            </div>
                            <div class="mt-2 pt-4 border-t border-gray-50 bg-slate-50/30 -mx-5 px-5">
                                <label class="text-[10px] font-black text-gray-400 uppercase tracking-wider mb-2 block">Standup Updates</label>
                                <div class="flex gap-2 mb-3">
                                    <input type="text" placeholder="Add comment and press Enter..." class="form-input form-input-sm flex-1" onkeypress="if(event.key === 'Enter') { commentManager.updateComment('${s.id}', this.value); this.value=''; }">
                                </div>
                                ${commentsHtml || '<p class="text-[10px] text-gray-400 italic py-1">No updates recorded yet.</p>'}
                            </div>
                        </div>
                        <div class="${isLate ? 'bg-google-red-light' : 'bg-slate-50'} p-4 flex justify-between items-center border-t border-gray-100 -mx-5 -mb-5 rounded-b-xl">
                            <div class="flex flex-col">
                                <span class="text-[10px] uppercase font-bold text-gray-400">Target Delivery</span>
                                <span class="text-sm font-bold ${isLate ? 'text-google-red' : 'text-slate-700'}">${s.calc.finalEnd instanceof Date ? s.calc.finalEnd.toLocaleDateString('en-GB') : 'Waiting'}</span>
                            </div>
                            <span class="text-xl">${isLate ? '⚠️' : '🗓️'}</span>
                        </div>
                    </div>
                    `;
                }).join('')}
            `;
        }).join('');
    },

    // =================================================================
    // KANBAN & SUPPORT KANBAN
    // =================================================================
    renderKanban() {
        const container = document.getElementById('kanban-container');
        if (!container) return;
        const filterSelect = document.getElementById('kanban-ba-filter');
        const searchInput = document.getElementById('kanban-search-input');
        const tagSearchInput = document.getElementById('kanban-tag-search-input');

        const searchTerm = searchInput ? searchInput.value.toLowerCase() : "";
        const tagSearchTerm = tagSearchInput ? tagSearchInput.value.toLowerCase() : "";

        const matchesSearch = (s) => {
            if (!searchTerm) return true;
            return (s.title && s.title.toLowerCase().includes(searchTerm)) ||
                (s.id && s.id.toString().includes(searchTerm)) ||
                (s.assignedTo && s.assignedTo.toLowerCase().includes(searchTerm)) ||
                (s.tester && s.tester.toLowerCase().includes(searchTerm)) ||
                (s.area && s.area.toLowerCase().includes(searchTerm));
        };
        const matchesTag = (s) => {
            if (!tagSearchTerm) return true;
            const allTags = [...(s.tags || []), ...(s.customTags || [])];
            return allTags.some(t => t.toLowerCase().includes(tagSearchTerm));
        };

        const regularCurrent = currentData.filter(s => !isBacklogStory(s) && isRegularStory(s));
        const regularBacklog = db.backlogStories.filter(s => isRegularStory(s));
        const allStoriesForAreas = [...regularCurrent, ...regularBacklog];

        if (allStoriesForAreas.length === 0) {
            container.innerHTML = `<div class="text-center py-20 text-gray-400 col-span-full">لا توجد قصص لعرضها.</div>`;
            return;
        }

        const areas = [...new Set(allStoriesForAreas.map(s => s.area || "General"))].sort();
        const currentSelected = Array.from(filterSelect.selectedOptions).map(opt => opt.value);
        filterSelect.multiple = true;
        filterSelect.size = Math.min(areas.length, 5);
        filterSelect.innerHTML = areas.map(a => {
            const selected = currentSelected.includes(a) ? 'selected' : '';
            return `<option value="${escapeHtml(a)}" ${selected}>${escapeHtml(a)}</option>`;
        }).join('');
        filterSelect.onchange = () => { this.renderKanban(); };

        let selectedAreas = Array.from(filterSelect.selectedOptions).map(opt => opt.value);
        if (selectedAreas.length === 0) selectedAreas = areas;
        const selectedAreasSet = new Set(selectedAreas);

        const filteredRegular = regularCurrent
            .filter(s => selectedAreasSet.has(s.area || "General") && matchesSearch(s) && matchesTag(s))
            .sort((a, b) => (a.priority || 999) - (b.priority || 999));

        const filteredBacklog = regularBacklog
            .filter(s => selectedAreasSet.has(s.area || "General") && matchesSearch(s) && matchesTag(s))
            .sort((a, b) => (a.priority || 999) - (b.priority || 999));

        const states = ["Active", "Active - With Bugs", "Resolved", "Tested", "On-Hold"];

        let html = `
            <div class="flex flex-nowrap gap-4 overflow-x-auto pb-4">
                <div class="kanban-column bg-purple-50 border-purple-200">
                    <div class="kanban-column-header">
                        <span>Backlog</span>
                        <span class="bg-purple-200 text-purple-800 text-xs px-2 py-0.5 rounded-full">${filteredBacklog.length}</span>
                    </div>
                    <div class="space-y-3 overflow-y-auto">
                        ${filteredBacklog.map(s => createStoryCard(s, { mode: 'backlog', showTagDropdown: true, showCommentsButton: false })).join('')}
                        ${filteredBacklog.length === 0 ? '<div class="text-center py-10 text-gray-300 text-sm italic">No backlog items</div>' : ''}
                    </div>
                </div>
        `;
        html += states.map(state => {
            const storiesInState = filteredRegular.filter(s => s.state === state);
            return `
                <div class="kanban-column">
                    <div class="kanban-column-header">
                        <span>${escapeHtml(state)}</span>
                        <span class="bg-gray-200 text-gray-700 text-xs px-2 py-0.5 rounded-full">${storiesInState.length}</span>
                    </div>
                    <div class="space-y-3 overflow-y-auto">
                        ${storiesInState.map(s => createStoryCard(s, { mode: 'regular', showTagDropdown: true })).join('')}
                        ${storiesInState.length === 0 ? '<div class="text-center py-10 text-gray-300 text-sm italic">Empty column</div>' : ''}
                    </div>
                </div>
            `;
        }).join('');
        html += `</div>`;
        container.innerHTML = html;
    },

    renderSupportKanban() {
        const container = document.getElementById('support-kanban-container');
        if (!container) return;
        const filterSelect = document.getElementById('support-kanban-ba-filter');
        const supportLogs = currentData.filter(s => s.type === 'Support log');

        if (supportLogs.length === 0) {
            container.innerHTML = `<div class="text-center py-20 text-gray-400 col-span-full">No Support logs found.</div>`;
            return;
        }

        const areas = [...new Set(supportLogs.map(s => s.area || "General"))].sort();
        const currentSelected = filterSelect.value;
        filterSelect.innerHTML = '<option value="all">All Areas</option>' + areas.map(a => `<option value="${escapeHtml(a)}" ${a === currentSelected ? 'selected' : ''}>${escapeHtml(a)}</option>`).join('');
        const selectedArea = filterSelect.value;

        const filteredLogs = selectedArea !== 'all'
            ? supportLogs.filter(s => (s.area || "General") === selectedArea)
            : supportLogs;

        const allStates = [...new Set(filteredLogs.map(s => s.state))].sort();
        const preferredOrder = ['Active', 'Resolved', 'Closed', 'On-Hold', 'Reactive', 'Rejected'];
        const orderedStates = preferredOrder.filter(st => allStates.includes(st));
        const remainingStates = allStates.filter(st => !preferredOrder.includes(st)).sort();
        const finalStates = [...orderedStates, ...remainingStates];

        container.innerHTML = finalStates.map(state => {
            const logsInState = filteredLogs.filter(s => s.state === state);
            return `
                <div class="kanban-column">
                    <div class="kanban-column-header">
                        <span>${escapeHtml(state)}</span>
                        <span class="bg-gray-200 text-gray-700 text-xs px-2 py-0.5 rounded-full">${logsInState.length}</span>
                    </div>
                    <div class="space-y-3 overflow-y-auto">
                        ${logsInState.map(s => createStoryCard(s, { mode: 'support', showTagDropdown: true, showCommentsButton: true })).join('')}
                        ${logsInState.length === 0 ? '<div class="text-center py-10 text-gray-300 text-sm italic">Empty column</div>' : ''}
                    </div>
                </div>
            `;
        }).join('');
    },

    // =================================================================
    // WEEKLY REPORT
    // =================================================================
    generateWeeklyReport() {
        const filterSelect = document.getElementById('kanban-ba-filter');
        if (!filterSelect) return;
        let selectedAreas = Array.from(filterSelect.selectedOptions).map(opt => opt.value);
        const allAreas = [...new Set([
            ...currentData.filter(s => !isBacklogStory(s) && isRegularStory(s)).map(s => s.area || "General"),
            ...db.backlogStories.map(s => s.area || "General")
        ])];
        if (selectedAreas.length === 0) selectedAreas = allAreas;

        const reportData = {};
        const targetStates = ['Active', 'Active - With Bugs', 'Resolved', 'On-Hold'];
        const fifteenDaysAgo = new Date();
        fifteenDaysAgo.setDate(fifteenDaysAgo.getDate() - 15);

        selectedAreas.forEach(area => {
            const areaData = { states: {}, backlog: [], tested: [], comments: [] };
            targetStates.forEach(state => {
                areaData.states[state] = currentData.filter(s =>
                    !isBacklogStory(s) && isRegularStory(s) && (s.area || "General") === area && s.state === state
                );
            });
            areaData.backlog = db.backlogStories.filter(s => (s.area || "General") === area && isRegularStory(s));
            areaData.tested = currentData.filter(s =>
                !isBacklogStory(s) && isRegularStory(s) && (s.area || "General") === area &&
                s.state === 'Tested' && s.changedDate && new Date(s.changedDate) >= fifteenDaysAgo
            );
            areaData.comments = db.areaComments.filter(c => c.area === area);
            reportData[area] = areaData;
        });
        this.showWeeklyReportModal(reportData);
    },

    showWeeklyReportModal(reportData) {
        let modal = document.getElementById('weekly-report-modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'weekly-report-modal';
            modal.className = 'fixed inset-0 bg-black/50 flex items-center justify-center z-[2000] p-4';
            modal.innerHTML = `
                <div class="bg-white rounded-2xl shadow-2xl max-w-7xl w-full max-h-[90vh] flex flex-col relative" style="direction: rtl;">
                    <div class="flex justify-between items-center p-4 border-b sticky top-0 bg-white z-10 rounded-t-2xl">
                        <h3 class="text-xl font-bold text-slate-800">📋 التقرير الأسبوعي</h3>
                        <div class="flex gap-2">
                            <button onclick="window.print()" class="btn btn-primary">🖨️ طباعة</button>
                            <button onclick="document.getElementById('weekly-report-modal').style.display='none'" class="text-slate-500 hover:text-google-red text-2xl font-bold leading-none">&times;</button>
                        </div>
                    </div>
                    <div class="p-6 overflow-y-auto" id="weekly-report-content"></div>
                </div>
            `;
            document.body.appendChild(modal);
            const style = document.createElement('style');
            style.textContent = `
                @media print {
                    body * { visibility: hidden; }
                    #weekly-report-modal, #weekly-report-modal * { visibility: visible; }
                    #weekly-report-modal {
                        position: absolute; left: 0; top: 0; width: 100%; background: white;
                        margin: 0; padding: 15px; box-shadow: none; border-radius: 0;
                        max-height: none; overflow: visible; direction: rtl;
                    }
                    #weekly-report-modal .sticky, #weekly-report-modal .border-b { position: relative; top: auto; }
                    #weekly-report-modal .p-6 { padding: 10px; }
                    #weekly-report-modal button { display: none !important; }
                    .page-break-after { page-break-after: always; }
                    .report-story-card { border: 1px solid #e2e8f0; padding: 4px 8px; margin-bottom: 4px; border-radius: 4px; font-size: 10px !important; }
                    .report-story-card .title { font-size: 10px !important; font-weight: bold; }
                    .report-tag { display: inline-block; padding: 0 4px; margin: 1px; font-size: 8px; border-radius: 2px; background: #f1f5f9; border: 1px solid #cbd5e1; }
                    .report-custom-tag { background: #f3e8ff; border-color: #a78bfa; }
                    .report-comment { background: #f0f4ff; padding: 2px 6px; border-radius: 3px; border-right: 2px solid #6366f1; margin-top: 2px; font-size: 9px; }
                    .state-column { border: 1px solid #e2e8f0; border-radius: 6px; padding: 6px; background: #f8fafc; }
                    .state-column h4 { font-size: 11px; font-weight: bold; margin-bottom: 4px; }
                }
            `;
            modal.querySelector('.bg-white').appendChild(style);
        }

        const content = document.getElementById('weekly-report-content');
        const dateStr = new Date().toLocaleDateString('ar-EG', { year: 'numeric', month: 'long', day: 'numeric' });
        let html = `<div class="text-center mb-6 border-b pb-4">
            <h1 class="text-2xl font-bold text-slate-800">تقرير الحالة الأسبوعي</h1>
            <p class="text-sm text-gray-500">تاريخ التقرير: ${escapeHtml(dateStr)}</p>
        </div>`;

        const truncateTitle = (title) => {
            if (!title) return '';
            const words = title.split(' ');
            return words.length <= 6 ? title : words.slice(0, 6).join(' ') + ' ...';
        };

        for (const area in reportData) {
            const { states, backlog, tested, comments } = reportData[area];
            html += `<div class="mb-12 page-break-after">`;
            html += `<h2 class="text-xl font-bold text-google-blue border-b-2 border-google-blue/30 pb-2 mb-4">📍 ${escapeHtml(area)}</h2>`;

            if (comments && comments.length > 0) {
                html += `<div class="mb-6 p-4 bg-google-yellow-light rounded-lg border border-google-yellow/30">`;
                html += `<h3 class="font-bold text-amber-700 text-sm flex items-center gap-2 mb-3">💬 تعليقات عامة على المنطقة</h3>`;
                html += `<div class="space-y-2">`;
                comments.forEach(c => {
                    html += `
                        <div class="bg-white p-2 rounded border border-amber-100 flex justify-between items-start gap-2">
                            <span class="text-sm text-slate-700" style="direction: rtl; text-align: right;">${escapeHtml(c.text)}</span>
                            <span class="text-[10px] text-gray-400 whitespace-nowrap">${escapeHtml(c.timestamp)}</span>
                        </div>
                    `;
                });
                html += `</div></div>`;
            } else {
                html += `<div class="text-gray-400 text-sm italic mb-4">لا توجد تعليقات عامة على هذه المنطقة.</div>`;
            }

            html += `<div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">`;
            const stateOrder = ['Active', 'Active - With Bugs', 'Resolved', 'On-Hold'];
            stateOrder.forEach(state => {
                const stories = states[state] || [];
                html += `<div class="state-column bg-gray-50 rounded-lg border border-gray-200 p-3">`;
                html += `<h4 class="font-bold text-sm text-slate-700 border-b pb-1 mb-2">${escapeHtml(state)} (${stories.length})</h4>`;
                if (stories.length === 0) {
                    html += `<div class="text-gray-400 text-[10px] italic">لا توجد</div>`;
                } else {
                    stories.forEach(s => {
                        const standupList = getStandupComments(s.id);
                        const lastComment = standupList.length > 0 ? standupList[standupList.length - 1] : null;
                        const customTags = s.customTags || [];
                        const allTags = [...new Set([...(s.tags || []), ...customTags])];
                        html += `<div class="report-story-card bg-white rounded border border-gray-100 p-2 mb-2 shadow-sm">`;
                        html += `<div class="flex justify-between items-start gap-2">`;
                        html += `<span class="font-mono text-[9px] text-gray-400">#${s.id}</span>`;
                        html += `<span class="title text-xs font-bold text-slate-800 flex-1">${escapeHtml(truncateTitle(s.title))}</span>`;
                        html += `</div>`;
                        if (allTags.length > 0) {
                            html += `<div class="flex flex-wrap gap-1 mt-1">`;
                            allTags.forEach(tag => {
                                const isCustom = customTags.includes(tag);
                                html += `<span class="report-tag px-1.5 py-0.5 text-[8px] font-bold rounded ${isCustom ? 'bg-purple-100 text-purple-700 border border-purple-300 report-custom-tag' : 'bg-gray-100 text-gray-600 border border-gray-200'}">${escapeHtml(tag)}${isCustom ? ' ★' : ''}</span>`;
                            });
                            html += `</div>`;
                        }
                        if (lastComment) {
                            html += `<div class="report-comment text-[9px] text-slate-600 mt-1">`;
                            html += `<span class="font-bold text-google-blue">اخر ستاندب:</span> `;
                            html += `<span>"${escapeHtml(lastComment.text)}"</span>`;
                            html += `<span class="text-[8px] text-gray-400 mr-1">(${escapeHtml(lastComment.date)})</span>`;
                            html += `</div>`;
                        }
                        html += `</div>`;
                    });
                }
                html += `</div>`;
            });
            html += `</div>`;

            if (backlog.length > 0) {
                const sortedBacklog = [...backlog].sort((a, b) => (a.priority || 999) - (b.priority || 999));
                const top5 = sortedBacklog.slice(0, 5);
                const withoutPriority = sortedBacklog.filter(s => s.priority === 999 || s.priority === undefined || s.priority === null);
                html += `<div class="mt-4 p-3 bg-purple-50 rounded-lg border border-purple-200">`;
                html += `<h3 class="font-bold text-purple-700 text-sm">📋 الباك لوج (${backlog.length})</h3>`;
                html += `<div class="flex flex-wrap gap-3 mt-2">`;
                top5.forEach(s => {
                    html += `<div class="bg-white px-3 py-1 rounded-full border border-purple-100 text-xs flex items-center gap-2 shadow-sm">`;
                    html += `<span class="font-mono text-gray-400">#${s.id}</span>`;
                    html += `<span class="font-medium text-slate-700">${escapeHtml(truncateTitle(s.title))}</span>`;
                    html += `<span class="bg-gray-200 text-gray-700 px-1.5 py-0.5 rounded text-[9px] font-bold">P${escapeHtml(s.priority)}</span>`;
                    html += `</div>`;
                });
                if (top5.length < backlog.length) html += `<span class="text-xs text-gray-400">... وغيرها</span>`;
                if (withoutPriority.length > 0) html += `<div class="w-full text-xs text-google-red mt-1">⚠️ يوجد ${withoutPriority.length} قصة بدون أولوية (Priority = 999)</div>`;
                html += `</div></div>`;
            } else {
                html += `<div class="text-gray-400 text-sm italic mt-2">لا يوجد باك لوج في هذه المنطقة.</div>`;
            }

            if (tested.length > 0) {
                html += `<div class="mt-4 p-3 bg-google-green-light rounded-lg border border-google-green/30">`;
                html += `<h3 class="font-bold text-google-green text-sm">✅ تم تسليمها (آخر 15 يوم) (${tested.length})</h3>`;
                html += `<div class="flex flex-wrap gap-2 mt-2">`;
                tested.forEach(s => {
                    html += `<span class="bg-white text-google-green px-2 py-0.5 rounded-full border border-google-green/20 text-xs font-mono">#${s.id}</span>`;
                });
                html += `</div></div>`;
            } else {
                html += `<div class="text-gray-400 text-sm italic mt-2">لا توجد قصص مسلمة في آخر 15 يوم.</div>`;
            }

            html += `</div>`;
        }
        content.innerHTML = html;
        modal.style.display = 'flex';
    },

    // =================================================================
    // DELIVERY
    // =================================================================
    renderDelivery() {
        const container = document.getElementById('delivery-grid');
        if (!container) return;
        const searchTerm = document.getElementById('search-delivery-input')?.value.toLowerCase() || "";
        const regularStories = currentData.filter(s => !isBacklogStory(s) && isRegularStory(s));
        const regularMap = new Map(regularStories.map(s => [String(s.id), s]));

        const pendingStories = regularStories.filter(s => {
            if (s.state !== 'Tested' && s.state !== 'Closed') return false;
            if (indexes.deliveryLogIds.has(String(s.id))) return false;
            return !searchTerm ||
                s.title.toLowerCase().includes(searchTerm) ||
                s.id.toString().includes(searchTerm) ||
                (s.area && s.area.toLowerCase().includes(searchTerm));
        });

        const completedStories = db.deliveryLogs.map(log => {
            const story = regularMap.get(String(log.storyId));
            return {
                ...story,
                logData: log,
                title: story ? story.title : "Story not in current CSV",
                area: story ? story.area : "N/A"
            };
        }).filter(s => {
            if (!s.id) return false;
            return !searchTerm ||
                s.title.toLowerCase().includes(searchTerm) ||
                s.logData.storyId.toString().includes(searchTerm) ||
                s.logData.to.toLowerCase().includes(searchTerm) ||
                (s.area && s.area.toLowerCase().includes(searchTerm));
        }).reverse();

        const createCardHtml = (s, isLogged) => {
            const tags = [...new Set([...(s.tags || []), ...(s.customTags || [])])];
            const tagsHtml = tags.length > 0 ? `
                <div class="flex flex-wrap gap-1 mb-2">
                    ${tags.map(tag => `
                        <span class="px-1.5 py-0.5 rounded text-[8px] font-bold uppercase tracking-tighter ${(s.customTags || []).includes(tag) ? 'bg-purple-200 text-purple-700 border border-purple-300' : 'bg-slate-100 text-slate-500 border border-slate-200'}">
                            ${escapeHtml(tag.trim())}
                        </span>
                    `).join('')}
                </div>
            ` : '';

            return `
                <div class="card p-4 border-2 transition-all ${isLogged ? 'border-gray-200 shadow-none' : 'border-google-blue/30 shadow-sm hover:border-google-blue'}">
                    ${tagsHtml}
                    <div class="flex justify-between items-start mb-2">
                        <span class="text-[10px] font-mono text-gray-400">#${isLogged ? s.logData.storyId : s.id}</span>
                    </div>
                    <div class="font-bold text-slate-800 mb-4 leading-snug">${escapeHtml(s.title)}</div>
                    <span class="text-xs font-bold ${isLogged ? 'text-google-green' : 'text-google-blue italic'}">${isLogged ? '✓ تم التسليم' : '*Tested*'}</span>
                    <div class="text-[10px] text-gray-500 mb-2 italic">Area: ${escapeHtml(s.area || "General")}</div>
                    ${isLogged ? `
                        <div class="relative group mt-2" dir="rtl">
                            <div class="text-xs bg-google-green-light text-google-green p-3 pr-12 rounded-lg border border-google-green/30 min-h-[60px] leading-relaxed">
                                <b>المستلم:</b> ${escapeHtml(s.logData.to)}<br>
                                <b>التاريخ:</b> ${escapeHtml(s.logData.date)}
                            </div>
                            ${currentUser && currentUser.role === 'admin' ? `
                                <button onclick="ui.editDelivery('${s.logData.storyId}')" class="absolute top-2 left-2 bg-white border border-google-green/30 shadow-sm text-gray-500 hover:text-google-blue hover:border-google-blue rounded-md p-1.5 text-[10px] transition-all z-10 flex items-center gap-1">
                                    <span>✏️</span>
                                    <span class="text-[9px] font-bold">تعديل</span>
                                </button>
                            ` : ''}
                        </div>
                    ` : (currentUser && currentUser.role === 'admin' ? `
                        <div class="flex gap-2 mt-auto">
                            <input id="to-${s.id}" placeholder="اسم المستلم..." class="form-input form-input-sm flex-1">
                            <button onclick="ui.markDelivered('${s.id}')" class="btn btn-primary text-xs">تأكيد</button>
                        </div>
                    ` : `<div class="text-xs text-gray-400 italic mt-auto">بانتظار تأكيد التسليم من الأدمن</div>`)}
                </div>
            `;
        };

        if (pendingStories.length === 0 && completedStories.length === 0) {
            container.innerHTML = `<div class="col-span-full text-center py-10 text-gray-400">${searchTerm ? 'لا توجد نتائج تطابق بحثك في قسم التسليم.' : 'لا توجد عناصر حالياً.'}</div>`;
            return;
        }

        container.innerHTML = `
            <div class="col-span-full mb-4"><h3 class="text-lg font-bold text-google-blue flex items-center gap-2">📦 بانتظار التسليم (${pendingStories.length})</h3></div>
            ${pendingStories.map(s => createCardHtml(s, false)).join('') || '<div class="col-span-full text-center text-gray-400 py-4">لا توجد نتائج</div>'}
            <div class="col-span-full my-8 border-t-2 border-dashed border-gray-200"></div>
            <div class="col-span-full mb-4"><h3 class="text-lg font-bold text-gray-500 flex items-center gap-2">✅ تم التسليم مؤخراً (${completedStories.length})</h3></div>
            ${completedStories.map(s => createCardHtml(s, true)).join('') || '<div class="col-span-full text-center text-gray-400 py-4">لا توجد نتائج</div>'}
        `;
    },

    markDelivered(id) {
        if (currentUser.role !== 'admin') return ui.showToast("عذراً، لا تملك صلاحية تنفيذ هذا الإجراء.", "error");
        const to = document.getElementById(`to-${id}`).value;
        if (!to) return ui.showToast("اكتب المستلم", "error");
        db.deliveryLogs.push({ storyId: id, to, date: new Date().toLocaleDateString(), timestamp: Date.now() });
        indexes.rebuildDeliveryLogs();
        dataProcessor.saveToGitHub();
        this.renderDelivery();
    },

    editDelivery(id) {
        if (currentUser.role !== 'admin') return;
        if (confirm("هل تريد إلغاء التسليم الحالي وتعديله؟")) {
            db.deliveryLogs = db.deliveryLogs.filter(log => log.storyId.toString() !== id.toString());
            indexes.rebuildDeliveryLogs();
            dataProcessor.saveToGitHub().then(() => {
                this.renderDelivery();
                setTimeout(() => {
                    const input = document.getElementById(`to-${id}`);
                    if (input) { input.focus(); input.classList.add('ring-2', 'ring-orange-400'); }
                }, 100);
            });
        }
    },

    // =================================================================
    // WORKLOAD
    // =================================================================
    renderWorkload() {
        const container = document.getElementById('workload-container');
        if (!container) return;
        const nonBacklog = currentData.filter(s => !isBacklogStory(s));
        const areaGroups = {};
        const MAX_HOURS = 65;
        const globalTaskWorkers = new Set();
        const supportWorkersGlobal = new Set();
        const bugWorkersGlobal = new Set();

        nonBacklog.forEach(story => {
            const area = story.area || "General Business Area";
            if (!areaGroups[area]) {
                areaGroups[area] = {
                    developers: {}, testers: {},
                    allDevsInArea: new Set(), allTestersInArea: new Set(),
                    activeDevStories: {}, activeTesterStories: {},
                    stories: []
                };
            }
            areaGroups[area].stories.push(story);

            if (story.assignedTo && story.assignedTo !== "Unassigned") areaGroups[area].allDevsInArea.add(story.assignedTo);
            if (story.tester && story.tester !== "Unassigned") areaGroups[area].allTestersInArea.add(story.tester);

            const isActiveStory = story.state !== 'Tested' && story.state !== 'Closed';
            if (isActiveStory && (story.type === 'User Story' || story.type === 'CR')) {
                if (story.assignedTo && story.assignedTo !== "Unassigned") areaGroups[area].activeDevStories[story.assignedTo] = (areaGroups[area].activeDevStories[story.assignedTo] || 0) + 1;
                if (story.tester && story.tester !== "Unassigned") areaGroups[area].activeTesterStories[story.tester] = (areaGroups[area].activeTesterStories[story.tester] || 0) + 1;
            }

            if (story.type === 'Support log' && isActiveStory) {
                if (story.assignedTo && story.assignedTo !== "Unassigned") supportWorkersGlobal.add(story.assignedTo);
                if (story.tester && story.tester !== "Unassigned") supportWorkersGlobal.add(story.tester);
            }

            (story.bugs || []).forEach(bug => {
                if (['New', 'Active'].includes(bug['State'])) {
                    const worker = bug['Assigned To'];
                    if (worker && worker !== "Unassigned") bugWorkersGlobal.add(worker);
                }
            });

            let dHours = 0;
            let tHours = 0;
            (story.tasks || []).forEach(t => {
                if (t['State'] !== 'To Be Reviewed' && t['State'] !== 'Closed') {
                    const est = parseFloat(t['Original Estimation'] || 0);
                    if (est > 0) {
                        const worker = (t['Activity'] === 'Testing') ? story.tester : story.assignedTo;
                        if (worker && worker !== "Unassigned") globalTaskWorkers.add(worker);
                    }
                    if (t['Activity'] === 'Development' || t['Activity'] === 'DB Modification') dHours += est;
                    else if (t['Activity'] === 'Testing') tHours += est;
                }
            });
            if (dHours > 0) areaGroups[area].developers[story.assignedTo] = (areaGroups[area].developers[story.assignedTo] || 0) + dHours;
            if (tHours > 0) areaGroups[area].testers[story.tester] = (areaGroups[area].testers[story.tester] || 0) + tHours;
        });

        const renderAvailableTag = (name) => {
            const isBusyGlobally = globalTaskWorkers.has(name);
            return `<span class="px-3 py-1.5 bg-white border border-slate-200 text-slate-600 text-[10px] font-bold rounded-full shadow-sm hover:border-google-green hover:text-google-green transition-colors flex items-center gap-1.5">${escapeHtml(name)}${isBusyGlobally ? '<span class="text-[8px] bg-google-yellow-light text-amber-600 px-1.5 py-0.5 rounded shadow-sm font-black ring-1 ring-amber-200">BUSY</span>' : ''}</span>`;
        };

        const areaEntries = Object.entries(areaGroups);
        container.innerHTML = areaEntries.map(([areaName, data], index) => {
            const activeDevs = Object.keys(data.activeDevStories).filter(name => data.activeDevStories[name] > 0);
            const activeDevsCount = activeDevs.length;
            const storiesInArea = data.stories;
            const testerStoriesCount = {};
            let devActiveCount = 0;
            let resolvedStoriesCount = 0;

            storiesInArea.forEach(s => {
                if (s.state === 'Active' || s.state === 'Active - With Bugs') devActiveCount++;
                else if (s.state === 'Resolved') resolvedStoriesCount++;
                if ((s.state === 'Resolved' || s.state === 'Active' || s.state === 'Active - With Bugs') && s.tester && s.tester !== "Unassigned") {
                    testerStoriesCount[s.tester] = (testerStoriesCount[s.tester] || 0) + 1;
                }
            });

            const activeTestersCount = Object.keys(testerStoriesCount).filter(name => testerStoriesCount[name] > 0).length;
            const devWipLimit = activeDevsCount * 2;
            const testerWipLimit = activeTestersCount * 2;
            const devWipUsage = devWipLimit > 0 ? Math.min((devActiveCount / devWipLimit) * 100, 100) : 0;
            const testerWipUsage = testerWipLimit > 0 ? Math.min((resolvedStoriesCount / testerWipLimit) * 100, 100) : 0;

            const allWorkers = new Set([...data.allDevsInArea, ...data.allTestersInArea]);
            const supportWorkersInArea = [];
            const bugWorkersInArea = [];
            allWorkers.forEach(worker => {
                if (supportWorkersGlobal.has(worker)) supportWorkersInArea.push(worker);
                else if (bugWorkersGlobal.has(worker)) bugWorkersInArea.push(worker);
            });

            const availableTesters = [...data.allTestersInArea].filter(name => !data.testers[name] && !supportWorkersGlobal.has(name) && !bugWorkersGlobal.has(name));
            const availableTesterSet = new Set(availableTesters);
            const finalAvailableDevs = [...data.allDevsInArea].filter(name => !data.developers[name] && !supportWorkersGlobal.has(name) && !bugWorkersGlobal.has(name) && !availableTesterSet.has(name));

            return `
                <div class="mb-16 bg-white rounded-[3rem] shadow-2xl shadow-slate-200/50 overflow-hidden border border-slate-100 cursor-move transition-all duration-300 hover:shadow-google-blue/10" draggable="true" ondragstart="ui.handleAreaDragStart(event, ${index})" ondragover="ui.handleAreaDragOver(event)" ondrop="ui.handleAreaDrop(event, ${index})">
                    <div class="bg-gradient-to-r from-slate-800 to-slate-900 p-6 px-10 flex justify-between items-center pointer-events-none">
                        <div>
                            <h2 class="text-2xl font-black text-white tracking-tight flex items-center gap-3"><span class="w-4 h-4 bg-google-blue rounded-full shadow-[0_0_10px_rgba(99,102,241,0.8)]"></span>${escapeHtml(areaName)}</h2>
                            <p class="text-slate-400 text-[10px] uppercase tracking-[0.2em] font-bold mt-1">Resource Allocation & Availability</p>
                        </div>
                        <i class="fas fa-grip-vertical text-slate-600 text-xl"></i>
                    </div>
                    <div class="px-10 py-3 bg-slate-50/80 border-b border-slate-200 space-y-1.5">
                        <div class="flex items-center gap-2 text-xs">
                            <span class="font-bold text-slate-600 w-24">Dev WIP (Active):</span>
                            <span class="font-mono font-black text-google-blue w-10">${devWipLimit}</span>
                            <span class="font-mono font-black ${devActiveCount > devWipLimit ? 'text-google-red' : 'text-slate-700'} w-10">${devActiveCount}</span>
                            <div class="flex-1 h-1.5 bg-gray-200 rounded-full overflow-hidden"><div class="${devWipUsage > 80 ? 'bg-google-yellow' : 'bg-google-green'} h-full rounded-full transition-all duration-1000" style="width: ${devWipUsage}%"></div></div>
                            <span class="text-[10px] text-slate-400 font-mono w-10">${Math.round(devWipUsage)}%</span>
                        </div>
                        <div class="flex items-center gap-2 text-xs">
                            <span class="font-bold text-slate-600 w-24">QA WIP (Resolved):</span>
                            <span class="font-mono font-black text-purple-700 w-10">${testerWipLimit}</span>
                            <span class="font-mono font-black ${resolvedStoriesCount > testerWipLimit ? 'text-google-red' : 'text-slate-700'} w-10">${resolvedStoriesCount}</span>
                            <div class="flex-1 h-1.5 bg-gray-200 rounded-full overflow-hidden"><div class="${testerWipUsage > 80 ? 'bg-google-yellow' : 'bg-purple-500'} h-full rounded-full transition-all duration-1000" style="width: ${testerWipUsage}%"></div></div>
                            <span class="text-[10px] text-slate-400 font-mono w-10">${Math.round(testerWipUsage)}%</span>
                        </div>
                        <div class="text-[10px] text-slate-400 pt-0.5"><span class="font-bold">${activeDevsCount}</span> Devs · <span class="font-bold">${activeTestersCount}</span> Testers</div>
                    </div>
                    <div class="p-10 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-8 pointer-events-none">
                        <div class="space-y-6">
                            <div class="flex items-center gap-2 pb-2 border-b-2 border-google-blue/30"><i class="fas fa-code text-google-blue"></i><h3 class="text-slate-800 font-black text-sm uppercase">Active Developers</h3></div>
                            ${this.generateStaffBarsWithCount(data.developers, 'google-blue', MAX_HOURS, data.activeDevStories)}
                        </div>
                        <div class="space-y-6">
                            <div class="flex items-center gap-2 pb-2 border-b-2 border-google-green/30"><i class="fas fa-vial text-google-green"></i><h3 class="text-slate-800 font-black text-sm uppercase">Active Testers</h3></div>
                            ${this.generateStaffBarsWithCount(data.testers, 'google-green', MAX_HOURS, data.activeTesterStories)}
                        </div>
                        <div class="space-y-6">
                            <div>
                                <div class="flex items-center gap-2 pb-2 border-b-2 border-amber-200"><i class="fas fa-headset text-amber-600"></i><h3 class="text-slate-800 font-black text-sm uppercase">Working On Support</h3></div>
                                <div class="space-y-3 mt-3">
                                    ${supportWorkersInArea.length > 0 ? supportWorkersInArea.map(worker => `
                                        <div class="flex items-center justify-between p-3 bg-google-yellow-light rounded-xl border border-amber-200">
                                            <div class="flex items-center gap-3"><div class="w-8 h-8 rounded-full bg-white flex items-center justify-center text-amber-600 font-bold text-xs border border-amber-200">${escapeHtml(worker.charAt(0))}</div><div><div class="text-xs font-bold text-slate-700">${escapeHtml(worker)}</div><div class="text-[9px] text-amber-600 uppercase font-bold">Support</div></div></div>
                                            <span class="text-[10px] bg-amber-200 text-amber-800 px-2 py-0.5 rounded-full font-bold">Active</span>
                                        </div>
                                    `).join('') : '<div class="text-slate-400 text-xs italic p-4 text-center">No active support</div>'}
                                </div>
                            </div>
                            <div>
                                <div class="flex items-center gap-2 pb-2 border-b-2 border-rose-200"><i class="fas fa-bug text-rose-600"></i><h3 class="text-slate-800 font-black text-sm uppercase">Working On Bugs</h3></div>
                                <div class="space-y-3 mt-3">
                                    ${bugWorkersInArea.length > 0 ? bugWorkersInArea.map(worker => `
                                        <div class="flex items-center justify-between p-3 bg-google-red-light rounded-xl border border-rose-200">
                                            <div class="flex items-center gap-3"><div class="w-8 h-8 rounded-full bg-white flex items-center justify-center text-rose-600 font-bold text-xs border border-rose-200">${escapeHtml(worker.charAt(0))}</div><div><div class="text-xs font-bold text-slate-700">${escapeHtml(worker)}</div><div class="text-[9px] text-rose-600 uppercase font-bold">Bugs</div></div></div>
                                            <span class="text-[10px] bg-rose-200 text-rose-800 px-2 py-0.5 rounded-full font-bold">Active</span>
                                        </div>
                                    `).join('') : '<div class="text-slate-400 text-xs italic p-4 text-center">No active bugs</div>'}
                                </div>
                            </div>
                        </div>
                        <div class="bg-slate-50 rounded-3xl p-6 border-2 border-dashed border-slate-200">
                            <div class="flex items-center gap-2 mb-4"><div class="w-8 h-8 rounded-full bg-google-green-light flex items-center justify-center text-google-green"><i class="fas fa-user-check text-xs"></i></div><h3 class="text-slate-800 font-black text-sm uppercase">Available For Tasks</h3></div>
                            <div class="mb-5"><p class="text-[9px] font-bold text-google-blue uppercase mb-2 tracking-widest flex items-center gap-2"><i class="fas fa-code text-[10px]"></i> Developers</p><div class="flex flex-wrap gap-2">${finalAvailableDevs.length > 0 ? finalAvailableDevs.map(renderAvailableTag).join('') : '<span class="text-[10px] text-slate-300 italic">No available developers</span>'}</div></div>
                            <div><p class="text-[9px] font-bold text-purple-600 uppercase mb-2 tracking-widest flex items-center gap-2"><i class="fas fa-vial text-[10px]"></i> Testers</p><div class="flex flex-wrap gap-2">${availableTesters.length > 0 ? availableTesters.map(renderAvailableTag).join('') : '<span class="text-[10px] text-slate-300 italic">No available testers</span>'}</div></div>
                        </div>
                    </div>
                </div>
            `;
        }).join('');

        const activeTab = document.querySelector('.tab-content.active');
        if (activeTab && activeTab.id === 'tab-workload') {
            const allFreeDevs = [];
            areaEntries.forEach(([areaName, data]) => {
                const freeDevsInArea = [...data.allDevsInArea].filter(name =>
                    !data.developers[name] && !supportWorkersGlobal.has(name) && !bugWorkersGlobal.has(name) && !globalTaskWorkers.has(name) && !data.allTestersInArea.has(name)
                );
                if (freeDevsInArea.length > 0) allFreeDevs.push({ area: areaName, devs: freeDevsInArea });
            });
            if (allFreeDevs.length > 0) this.showFreeDevelopersPopup(allFreeDevs);
        }
    },

    generateStaffBarsWithCount(staffData, color, max, storyCounts) {
        const entries = Object.entries(staffData);
        if (entries.length === 0) return `<div class="text-gray-300 text-sm italic">No active tasks</div>`;

        const colorMap = {
            'google-blue': '#3b82f6',
            'google-green': '#22c55e',
            'google-yellow': '#eab308',
            'google-red': '#ef4444'
        };
        const defaultColor = colorMap[color] || '#3b82f6';

        return entries.sort((a, b) => b[1] - a[1]).map(([name, hours]) => {
            const perc = Math.min((hours / max) * 100, 100);
            const isOver = hours > max;
            let barColor = defaultColor;
            if (isOver) barColor = '#ef4444';
            else if (perc > 80) barColor = '#eab308';

            const storyCount = storyCounts[name] || 0;
            return `
                <div class="relative p-3 bg-slate-50/50 rounded-2xl border border-slate-100 hover:bg-slate-50 transition-colors">
                    <div class="flex justify-between mb-2 items-start">
                        <span class="font-bold text-sm text-slate-700">${escapeHtml(name)} <span class="text-[10px] font-normal text-gray-400">(${storyCount} ${storyCount === 1 ? 'story' : 'stories'})</span></span>
                        <span class="text-xs font-mono ${isOver ? 'text-red-600 font-black' : 'text-slate-500'}">${hours.toFixed(1)} <span class="text-[10px] text-slate-400">/ ${max}h</span></span>
                    </div>
                    <div class="w-full bg-gray-200/70 rounded-full h-2">
                        <div class="h-2 rounded-full transition-all duration-1000 shadow-sm" style="width: ${perc}%; background-color: ${barColor};"></div>
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
                        <button onclick="document.getElementById('free-devs-modal').style.display='none'" class="text-slate-500 hover:text-google-red text-2xl font-bold leading-none">&times;</button>
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
                    <h4 class="font-bold text-google-blue text-sm border-b pb-1 mb-2">${escapeHtml(item.area)}</h4>
                    <div class="flex flex-wrap gap-2">${item.devs.map(name => `<span class="px-3 py-1 bg-google-green-light text-google-green rounded-full text-xs font-bold border border-google-green/30">${escapeHtml(name)}</span>`).join('')}</div>
                </div>
            `).join('');
        }
        modal.style.display = 'flex';
    },

    handleAreaDragStart(event, index) {
        event.dataTransfer.setData('text/plain', index);
        setTimeout(() => event.target.classList.add('opacity-40'), 0);
    },

    handleAreaDragOver(event) {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
    },

    handleAreaDrop(event, targetIndex) {
        event.preventDefault();
        const sourceIndex = parseInt(event.dataTransfer.getData('text/plain'));
        if (sourceIndex === targetIndex) return;
        const nonBacklog = currentData.filter(s => !isBacklogStory(s));
        const currentAreas = Array.from(new Set(nonBacklog.map(s => s.area || "General Business Area")));
        const movedAreaName = currentAreas.splice(sourceIndex, 1)[0];
        currentAreas.splice(targetIndex, 0, movedAreaName);
        const reorderedData = [];
        currentAreas.forEach(areaName => {
            reorderedData.push(...nonBacklog.filter(s => (s.area || "General Business Area") === areaName));
        });
        const backlogStories = currentData.filter(s => isBacklogStory(s));
        currentData = [...reorderedData, ...backlogStories];
        this.renderWorkload();
    },

    // =================================================================
    // STORY & COMMENTS MODALS
    // =================================================================
    openStoryModal(storyId) {
        const s = findStoryById(storyId);
        if (!s) return;
        const modal = document.getElementById('story-modal');
        const title = document.getElementById('modal-title');
        const body = document.getElementById('modal-body');
        title.innerText = `[#${s.id}] ${s.title}`;

        const timelineContainerId = `story-timeline-container-${s.id}`;
        const timelineBlockHtml = `
            <div class="mt-6 border-t-2 border-dashed border-indigo-200 pt-4">
                <h4 class="font-bold text-slate-700 text-sm mb-3 flex items-center gap-2">
                    📅 Story Timeline
                    <span class="text-[10px] font-normal text-gray-400">(state history + PR overlays)</span>
                </h4>
                <div id="${timelineContainerId}"></div>
            </div>
        `;

        if (isBacklogStory(s)) {
            body.innerHTML = `
                <div class="grid grid-cols-2 gap-4 text-sm">
                    <div class="bg-slate-50 p-3 rounded-lg"><p class="text-gray-500 text-xs font-bold uppercase">Business Area</p><p class="font-semibold text-slate-700">${escapeHtml(s.area)}</p></div>
                    <div class="bg-slate-50 p-3 rounded-lg"><p class="text-gray-500 text-xs font-bold uppercase">Priority</p><p class="font-semibold text-slate-700">P${escapeHtml(s.priority)}</p></div>
                </div>
                <div class="bg-purple-50 p-4 rounded-xl border border-purple-200">
                    <div class="flex items-center gap-2 text-purple-700"><span class="text-lg">📋</span><span class="font-bold">This story is in the Backlog</span></div>
                    <p class="text-sm text-slate-600 mt-2">State: ${escapeHtml(s.state)}</p>
                    ${s.expectedRelease ? `<p class="text-sm text-slate-600">Expected Release: ${escapeHtml(s.expectedRelease.toLocaleDateString('en-GB'))}</p>` : ''}
                    ${s.assignedTo ? `<p class="text-sm text-slate-600">Assigned To: ${escapeHtml(s.assignedTo)}</p>` : ''}
                </div>
                <div class="mt-6 p-4 bg-google-blue-light rounded-xl border border-google-blue/30">
                    <div class="flex justify-between items-center"><span class="text-xs font-bold text-slate-500 uppercase">Client Release Date</span><span class="text-sm font-bold text-slate-700">${s.expectedRelease instanceof Date ? escapeHtml(s.expectedRelease.toLocaleDateString()) : 'Not Scheduled'}</span></div>
                </div>
            `;
        } else {
            const nonTestTasks = s.tasks.filter(t => t['Activity'] !== 'Testing' && t['Activity'] !== 'Preparation');
            body.innerHTML = `
                <div class="grid grid-cols-2 gap-4 text-sm">
                    <div class="bg-slate-50 p-3 rounded-lg"><p class="text-gray-500 text-xs font-bold uppercase">Business Area</p><p class="font-semibold text-slate-700">${escapeHtml(s.area)}</p></div>
                    <div class="bg-slate-50 p-3 rounded-lg"><p class="text-gray-500 text-xs font-bold uppercase">Priority</p><p class="font-semibold text-slate-700">P${escapeHtml(s.priority)}</p></div>
                </div>
                <div class="space-y-4">
                    <h4 class="font-bold text-google-blue border-b pb-1">🛠 Development Details</h4>
                    <div class="grid grid-cols-2 gap-2 text-xs"><p><b>Assigned To:</b> ${escapeHtml(s.assignedTo)}</p><p><b>Dev End:</b> ${s.calc.devEnd instanceof Date ? escapeHtml(s.calc.devEnd.toLocaleString()) : 'TBD'}</p></div>
                    <div class="space-y-1">${nonTestTasks.map(t => `
                        <div class="flex justify-between text-[11px] bg-white border p-2 rounded shadow-sm">
                            <span class="flex items-start gap-2"><span class="font-mono text-google-blue font-bold bg-google-blue-light px-1 rounded">#${escapeHtml(t['ID'])}</span><span>${escapeHtml(t['Title'])}</span></span>
                            <span class="px-2 rounded h-fit ${t['State'] === 'Closed' ? 'bg-google-green-light text-google-green' : 'bg-google-yellow-light text-amber-700'}">${escapeHtml(t['State'])}</span>
                        </div>
                    `).join('')}</div>
                </div>
                ${this.renderPullRequestsForStory(s)}
                <div class="space-y-4">
                    <h4 class="font-bold text-purple-700 border-b pb-1">🔍 QA & Testing</h4>
                    <div class="grid grid-cols-2 gap-2 text-xs"><p><b>Tester:</b> ${escapeHtml(s.tester)}</p><p><b>Test End:</b> ${s.calc.testEnd instanceof Date ? escapeHtml(s.calc.testEnd.toLocaleString()) : 'Waiting'}</p></div>
                    <div class="space-y-1">${s.testCases && s.testCases.length > 0 ? s.testCases.map(tc => `
                        <div class="flex justify-between text-[11px] bg-white border p-2 rounded shadow-sm">
                            <span>TC #${escapeHtml(tc.id)}</span>
                            <span class="font-bold ${tc.state === 'Pass' ? 'text-google-green' : 'text-google-red'}">${escapeHtml(tc.state)}</span>
                        </div>
                    `).join('') : '<p class="text-xs text-gray-400 italic">No test cases linked yet.</p>'}</div>
                </div>
                ${s.bugs && s.bugs.length > 0 ? `
                    <div class="space-y-2">
                        <h4 class="font-bold text-google-red border-b pb-1">🐞 Bugs (${s.bugs.length})</h4>
                        ${s.bugs.map(b => `
                            <div class="text-[11px] border-l-2 border-google-red pl-2 py-1">
                                <div class="flex justify-between items-start gap-2">
                                    <p class="font-bold flex-1">
                                        <span class="font-mono text-google-red bg-google-red-light px-1.5 py-0.5 rounded text-[10px] mr-1">#${escapeHtml(b['ID'])}</span>
                                        ${escapeHtml(b['Title'])}
                                    </p>
                                </div>
                                <p class="text-gray-500 mt-0.5">
                                    <span class="font-bold">State:</span> ${escapeHtml(b['State'])} |
                                    <span class="font-bold">Estimation:</span> ${escapeHtml(b['Original Estimation'])}h |
                                    <span class="font-bold">Assigned To:</span> ${escapeHtml(b['Assigned To'] || 'Unassigned')}
                                </p>
                            </div>
                        `).join('')}
                    </div>
                ` : ''}
                <div class="mt-6 p-4 bg-google-blue-light rounded-xl border border-google-blue/30">
                    <div class="flex justify-between items-center mb-2"><span class="text-xs font-bold text-google-blue uppercase">Internal Delivery Target</span><span class="text-sm font-bold text-google-blue">${s.calc.finalEnd instanceof Date ? escapeHtml(s.calc.finalEnd.toLocaleString()) : 'Calculating...'}</span></div>
                    <div class="flex justify-between items-center"><span class="text-xs font-bold text-slate-500 uppercase">Client Release Date</span><span class="text-sm font-bold text-slate-700">${s.expectedRelease instanceof Date ? escapeHtml(s.expectedRelease.toLocaleDateString()) : 'Not Scheduled'}</span></div>
                </div>
                ${timelineBlockHtml}
            `;
        }
        modal.classList.remove('hidden');
        document.body.style.overflow = 'hidden';

        if (!isBacklogStory(s) && isRegularStory(s)) {
            timelineManager.loadAndRender(s, timelineContainerId);
        }
    },

    closeModal() {
        document.getElementById('story-modal').classList.add('hidden');
        document.body.style.overflow = 'auto';
    },

    openCommentsModal(storyId) {
        const s = findStoryById(storyId);
        if (!s) return;
        const modal = document.getElementById('story-modal');
        const title = document.getElementById('modal-title');
        const body = document.getElementById('modal-body');
        title.innerText = `[#${s.id}] Standup Updates`;
        const comments = getStandupComments(s.id);
        body.innerHTML = `
            <div class="bg-slate-50/30 px-2">
                <div class="flex gap-2 mb-4">
                    <input type="text" id="kanban-comment-input" placeholder="Add new update and press Enter..." class="form-input flex-1" onkeypress="if(event.key === 'Enter') { commentManager.updateComment('${s.id}', this.value); this.value=''; ui.openCommentsModal('${s.id}'); ui.renderKanban(); }">
                </div>
                <div class="space-y-3 max-h-[60vh] overflow-y-auto pr-2">
                    ${comments.slice().reverse().map(c => `
                        <div class="bg-white p-3 rounded-xl border border-google-blue/20 shadow-sm">
                            <div class="flex justify-between items-center mb-2"><span class="text-[10px] font-bold text-google-blue bg-google-blue-light px-2 py-1 rounded">${escapeHtml(c.date)}</span></div>
                            <p class="text-sm text-slate-700 leading-relaxed italic">"${escapeHtml(c.text)}"</p>
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
            html += `<div class="border-b pb-2"><h4 class="font-bold text-google-blue">${escapeHtml(area)}</h4>`;
            grouped[area].forEach(s => {
                html += `
                    <div class="flex justify-between items-center border-b border-gray-100 py-1 hover:bg-gray-50 cursor-pointer" onclick="ui.openStoryModal('${s.id}')">
                        <span class="text-sm">#${s.id} - ${escapeHtml(s.title)}</span>
                        <span class="status-badge ${s.state === 'Tested' ? 'status-tested' : 'status-active'}">${escapeHtml(s.state)}</span>
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

    showBranchModal(encodedBranch) {
        const branch = decodeURIComponent(encodedBranch);
        const activeStories = currentData.filter(s =>
            !isBacklogStory(s) && isRegularStory(s) &&
            (s.branch || 'N/A') === branch && s.state !== 'Tested' && s.state !== 'Closed'
        );
        this.showModalWithTitleAndStories(`Branch: ${escapeHtml(branch)} (${activeStories.length} active stories)`, activeStories);
    },

    showCustomerModal(encodedCustomer) {
        const customer = decodeURIComponent(encodedCustomer);
        const activeStories = currentData.filter(s =>
            !isBacklogStory(s) && isRegularStory(s) &&
            (s.customer || 'General') === customer && s.state !== 'Tested' && s.state !== 'Closed'
        );
        this.showModalWithTitleAndStories(`Customer: ${escapeHtml(customer)} (${activeStories.length} active stories)`, activeStories);
    },

    // =================================================================
    // DAILY ACTIVITY & INACTIVE STORIES
    // =================================================================
    renderDailyActivity() {
        const container = document.getElementById('daily-activity-container');
        if (!container) return;
        const todayStr = new Date().toISOString().split('T')[0];
        const activities = [];
        currentData.forEach(story => {
            if (isBacklogStory(story) || !isRegularStory(story)) return;
            let hasActivityToday = false;
            const storyDate = story.changedDate ? new Date(story.changedDate).toISOString().split('T')[0] : null;
            if (storyDate === todayStr) hasActivityToday = true;
            else if (story.tasks && story.tasks.length > 0) {
                hasActivityToday = story.tasks.some(task => task['Changed Date'] && new Date(task['Changed Date']).toISOString().split('T')[0] === todayStr);
            }
            if (hasActivityToday) activities.push(story);
        });

        if (activities.length === 0) {
            container.innerHTML = `<div class="bg-white p-10 rounded-xl border-2 border-dashed border-gray-200 text-center text-gray-400">No updates recorded for today (${escapeHtml(todayStr)})</div>`;
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
            const branchItemsCount = Object.values(grouped[branch]).reduce((sum, area) => sum + Object.values(area).reduce((s, cust) => s + cust.length, 0), 0);
            html += `
            <div class="card overflow-hidden">
                <div class="bg-slate-50 px-4 py-2 border-b border-slate-200 flex justify-between items-center">
                    <span class="font-bold text-slate-700 text-sm"><i class="fas fa-code-branch mr-2 text-google-blue"></i>${escapeHtml(branch)}</span>
                    <span class="bg-google-blue text-white text-[10px] px-2 py-0.5 rounded-full font-bold">${branchItemsCount} Today</span>
                </div>
                <div class="p-4 space-y-4">`;
            for (const area in grouped[branch]) {
                html += `<div><h4 class="text-xs font-black text-google-blue mb-2 uppercase tracking-tighter italic underline">${escapeHtml(area)}</h4>`;
                for (const customer in grouped[branch][area]) {
                    html += `<div class="ml-2 mb-3"><div class="text-[11px] font-bold text-slate-400 mb-2 border-l-2 border-slate-200 pl-2 tracking-widest uppercase">Target: ${escapeHtml(customer)}</div>`;
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

    renderDailyActivitySummary(activities) {
        const total = activities.length;
        const states = {};
        const branchStatsMap = {};
        const areaStatsMap = {};

        activities.forEach(s => {
            states[s.state] = (states[s.state] || 0) + 1;
            const branchName = s.branch || "Unknown";
            branchStatsMap[branchName] = (branchStatsMap[branchName] || 0) + 1;
            const areaName = s.area || "General";
            areaStatsMap[areaName] = (areaStatsMap[areaName] || 0) + 1;
        });

        const branchStats = Object.entries(branchStatsMap).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
        const areaStats = Object.entries(areaStatsMap).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);

        return `
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
            <div class="bg-gradient-to-br from-blue-100 to-blue-200 p-5 rounded-2xl shadow-lg text-slate-800">
                <div class="text-[10px] opacity-80 font-bold uppercase tracking-widest text-center">Total Daily Activities</div>
                <div class="text-5xl font-black mt-2 text-center">${total}</div>
                <div class="text-[10px] mt-3 bg-white/50 text-center px-2 py-1 rounded-md">Matching all charts below</div>
            </div>
            <div class="col-span-1 md:col-span-2 bg-white p-4 rounded-2xl shadow-sm border border-slate-100">
                <div class="text-[10px] text-gray-400 font-bold uppercase mb-3">Status Breakdown</div>
                <div class="flex flex-wrap gap-2">${Object.entries(states).map(([state, count]) => `
                    <div class="bg-slate-50 px-3 py-2 rounded-xl border border-slate-100 flex-1 min-w-[100px]">
                        <div class="text-[9px] font-bold text-slate-500 truncate">${escapeHtml(state)}</div>
                        <div class="text-lg font-black text-google-blue">${count}</div>
                    </div>
                `).join('')}</div>
            </div>
        </div>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
            <div class="bg-white p-4 rounded-2xl shadow-sm border border-slate-100">
                <div class="text-[10px] text-google-blue font-bold uppercase mb-2 flex justify-between"><span>📊 Branches Summary</span><span>Sum: ${branchStats.reduce((a, b) => a + b.count, 0)}</span></div>
                <div class="space-y-3 mt-2">${branchStats.slice(0, 5).map(branch => {
                    const width = (branch.count / total) * 100;
                    return `<div><div class="flex justify-between text-[10px] mb-1 font-bold text-slate-600"><span class="truncate pr-2">${escapeHtml(branch.name)}</span><span>${branch.count}</span></div><div class="w-full bg-slate-100 h-1.5 rounded-full overflow-hidden"><div class="bg-google-blue h-full rounded-full" style="width: ${width}%"></div></div></div>`;
                }).join('')}</div>
            </div>
            <div class="bg-white p-4 rounded-2xl shadow-sm border border-slate-100">
                <div class="text-[10px] text-purple-600 font-bold uppercase mb-2 flex justify-between"><span>📂 Areas Summary</span><span>Sum: ${areaStats.reduce((a, b) => a + b.count, 0)}</span></div>
                <div class="space-y-3 mt-2">${areaStats.slice(0, 5).map(area => {
                    const width = (area.count / total) * 100;
                    return `<div><div class="flex justify-between text-[10px] mb-1 font-bold text-slate-600"><span class="truncate pr-2">${escapeHtml(area.name)}</span><span>${area.count}</span></div><div class="w-full bg-slate-100 h-1.5 rounded-full overflow-hidden"><div class="bg-purple-500 h-full rounded-full" style="width: ${width}%"></div></div></div>`;
                }).join('')}</div>
            </div>
        </div>
        `;
    },

    renderStoryCard(s) {
        const isLate = s.calc.finalEnd instanceof Date && new Date() > s.calc.finalEnd;
        const statusColor = isLate ? "status-delayed" : "status-active";
        return `
        <div onclick="ui.openStoryModal('${s.id}')" class="group p-3 mb-2 bg-slate-50 border border-slate-100 rounded-xl hover:border-google-blue hover:bg-white transition-all cursor-pointer">
            <div class="flex justify-between items-start mb-2">
                <span class="status-badge ${statusColor}">${escapeHtml(s.state)}</span>
                <span class="text-[9px] text-slate-400 font-mono">#${s.id}</span>
            </div>
            <h5 class="text-xs font-bold text-slate-800 group-hover:text-google-blue transition-colors line-clamp-1">${escapeHtml(s.title)}</h5>
            <div class="flex items-center gap-4 mt-2">
                <div class="flex items-center gap-1"><span class="text-[9px] text-slate-400 font-bold uppercase tracking-tighter">Dev:</span><span class="text-[10px] font-medium text-slate-600">${escapeHtml(s.assignedTo)}</span></div>
                <div class="flex items-center gap-1"><span class="text-[9px] text-slate-400 font-bold uppercase tracking-tighter">Testing:</span><span class="text-[10px] font-medium text-slate-600">${escapeHtml(s.tester)}</span></div>
            </div>
        </div>`;
    },

    exportDailyActivityToExcel() {
        const todayStr = new Date().toISOString().split('T')[0];
        const activities = [];
        currentData.forEach(story => {
            if (isBacklogStory(story) || !isRegularStory(story)) return;
            let hasActivityToday = false;
            const storyDate = story.changedDate ? new Date(story.changedDate).toISOString().split('T')[0] : null;
            if (storyDate === todayStr) hasActivityToday = true;
            else if (story.tasks && story.tasks.length > 0) {
                hasActivityToday = story.tasks.some(task => task['Changed Date'] && new Date(task['Changed Date']).toISOString().split('T')[0] === todayStr);
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
        if (activities.length === 0) return ui.showToast("لا توجد أنشطة مسجلة بتاريخ اليوم لتصديرها", "error");

        const grouped = activities.reduce((acc, item) => {
            if (!acc[item.branch]) acc[item.branch] = {};
            if (!acc[item.branch][item.area]) acc[item.branch][item.area] = {};
            if (!acc[item.branch][item.area][item.customer]) acc[item.branch][item.area][item.customer] = [];
            acc[item.branch][item.area][item.customer].push(item);
            return acc;
        }, {});

        let csvContent = "\uFEFFLevel,Identifier,Details/Title,Owner,Status\n";
        for (const branch in grouped) {
            let branchCount = 0;
            Object.values(grouped[branch]).forEach(area => Object.values(area).forEach(cust => branchCount += cust.length));
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
        URL.revokeObjectURL(url);
    },

    renderInactiveStories() {
        const container = document.getElementById('inactive-stories-container');
        if (!container) return;
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const inactive = currentData.filter(s => {
            if (isBacklogStory(s) || !isRegularStory(s)) return false;
            if (s.state === 'Tested' || s.state === 'Closed') return false;
            const lastChange = s.changedDate ? new Date(s.changedDate) : null;
            return !lastChange || lastChange < today;
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
                        <h3 class="text-xl font-extrabold text-slate-800">${escapeHtml(area)}</h3>
                        <span class="px-3 py-1 bg-google-blue-light text-google-blue rounded-full text-xs font-bold">${groupedByArea[area].length} Stories</span>
                        <div class="flex-grow h-px bg-slate-200"></div>
                    </div>
                </div>
            `;
            groupedByArea[area].forEach(s => {
                const lastAction = s.changedDate ? new Date(s.changedDate) : now;
                const diffDays = Math.floor(Math.abs(now - lastAction) / (1000 * 60 * 60 * 24));
                let dayColorClass = "text-google-green border-google-green/30 bg-google-green-light";
                if (diffDays > 1 && diffDays <= 3) dayColorClass = "text-amber-500 border-amber-200 bg-google-yellow-light";
                else if (diffDays > 3) dayColorClass = "text-google-red border-google-red/30 bg-google-red-light";
                html += `
                    <div class="col-span-full lg:col-span-1 bg-white p-5 rounded-2xl border border-slate-100 shadow-sm hover:shadow-md transition-all cursor-pointer flex items-center gap-5" onclick="ui.openStoryModal('${s.id}')">
                        <div class="flex flex-col items-center justify-center min-w-[80px] h-[80px] rounded-2xl border-2 ${dayColorClass}">
                            <span class="text-3xl font-black leading-none">${diffDays}</span>
                            <span class="text-[9px] font-bold uppercase mt-1">Days</span>
                        </div>
                        <div class="flex-grow min-w-0">
                            <div class="flex items-center gap-2 mb-1">
                                <span class="text-[10px] font-bold text-slate-400">#${s.id}</span>
                                <span class="px-2 py-0.5 bg-slate-100 text-[9px] font-bold rounded uppercase text-slate-500">${escapeHtml(s.state)}</span>
                                <span class="ml-auto font-bold text-google-blue text-[10px]">P${escapeHtml(s.priority)}</span>
                            </div>
                            <h3 class="font-bold text-slate-800 text-sm mb-1 truncate" title="${escapeHtml(s.title)}">${escapeHtml(s.title)}</h3>
                            <div class="flex flex-wrap gap-1 mb-2">${(s.tags || []).map(t => `<span class="px-2 py-0.5 bg-google-red-light text-google-red border border-google-red/30 rounded text-[9px] font-semibold">${escapeHtml(t)}</span>`).join('')}</div>
                            <div class="flex flex-wrap gap-y-1 gap-x-4">
                                <div class="flex items-center gap-1 text-[11px] text-slate-500"><span class="font-semibold text-slate-700">Dev:</span> ${escapeHtml(s.assignedTo || '---')}</div>
                                <div class="flex items-center gap-1 text-[11px] text-slate-500"><span class="font-semibold text-slate-700">QA:</span> ${escapeHtml(s.tester || '---')}</div>
                                <div class="flex items-center gap-1 text-[11px] text-google-red"><span class="font-semibold">Last:</span> ${s.changedDate ? escapeHtml(new Date(s.changedDate).toLocaleDateString('en-GB')) : 'N/A'}</div>
                            </div>
                        </div>
                    </div>
                `;
            });
        }
        container.innerHTML = `<div class="grid grid-cols-1 xl:grid-cols-2 gap-4">${html}</div>`;
    },

    // =================================================================
    // SETTINGS & AUDITOR
    // =================================================================
    renderSettings() {
        const nonBacklog = currentData.filter(s => !isBacklogStory(s) && isRegularStory(s));
        const staff = [...new Set(nonBacklog.map(s => s.assignedTo).concat(nonBacklog.map(s => s.tester)))];
        const staffSelect = document.getElementById('staff-select');
        if (staffSelect) staffSelect.innerHTML = staff.map(s => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join('');

        const vacationsList = document.getElementById('vacations-list');
        if (vacationsList) {
            vacationsList.innerHTML = db.vacations.map((v, i) => `
                <div class="flex justify-between bg-gray-50 p-1 px-2 rounded mb-1"><span>${escapeHtml(v.name)} - ${escapeHtml(v.date)}</span><button onclick="settings.removeVacation(${i})" class="text-google-red">×</button></div>
            `).join('');
        }

        const holidaysList = document.getElementById('holidays-list');
        if (holidaysList) {
            holidaysList.innerHTML = db.holidays.map((h, i) => `
                <span class="bg-gray-200 px-2 py-1 rounded text-xs inline-flex items-center gap-1 m-1">${escapeHtml(h)} <button onclick="settings.removeHoliday(${i})" class="text-google-red">×</button></span>
            `).join('');
        }

        const usersList = document.getElementById('users-list');
        if (usersList) {
            usersList.innerHTML = db.users.map((u, i) => `
                <div class="flex justify-between items-center bg-gray-50 p-2 rounded border">
                    <div><span class="font-bold text-slate-700">${escapeHtml(u.username)}</span><span class="text-[10px] ml-2 px-2 py-0.5 rounded-full ${u.role === 'admin' ? 'bg-google-red-light text-google-red' : 'bg-google-blue-light text-google-blue'}">${escapeHtml(u.role)}</span></div>
                    <button onclick="settings.removeUser(${i})" class="text-google-red hover:text-red-700 font-bold text-xl">&times;</button>
                </div>
            `).join('');
        }
        tagManager.renderTagsSettings();
    },

    renderAuditorChecklist() {
        const tbody = document.getElementById('auditor-table-body');
        if (!tbody) return;
        const areaFilter = document.getElementById('auditor-area-filter')?.value || 'all';
        const stateFilter = document.getElementById('auditor-state-filter')?.value || 'all';
        const areaSelect = document.getElementById('auditor-area-filter');
        const nonBacklog = currentData.filter(s => !isBacklogStory(s) && isRegularStory(s));

        if (areaSelect && areaSelect.options.length <= 1) {
            const areas = [...new Set(nonBacklog.map(s => s.area || "General"))];
            areaSelect.innerHTML = '<option value="all">All Areas</option>' + areas.map(a => `<option value="${escapeHtml(a)}">${escapeHtml(a)}</option>`).join('');
        }

        const filtered = nonBacklog.filter(s =>
            (areaFilter === 'all' || (s.area || "General") === areaFilter) &&
            (stateFilter === 'all' || s.state === stateFilter)
        );

        if (filtered.length === 0) {
            tbody.innerHTML = `<tr><td colspan="11" class="text-center py-8 text-gray-400">No stories match the selected filters.</td></tr>`;
            return;
        }

        tbody.innerHTML = filtered.map(story => {
            const criteria = this.evaluateStoryCompliance(story);
            const compliancePercent = Math.round((criteria.passedCount / criteria.totalCount) * 100);
            let barColor = '#ef4444';
            if (compliancePercent >= 80) barColor = '#22c55e';
            else if (compliancePercent >= 50) barColor = '#eab308';

            return `
                <tr class="border-b hover:bg-gray-50 transition">
                    <td class="px-4 py-3 font-mono text-xs">#${story.id}</td>
                    <td class="px-4 py-3 font-medium text-slate-700 max-w-xs truncate" title="${escapeHtml(story.title)}">${escapeHtml(story.title)}</td>
                    <td class="px-4 py-3"><span class="status-badge status-active">${escapeHtml(story.state)}</span></td>
                    <td class="px-4 py-3 text-center">
                        <div class="flex flex-col items-center gap-1">
                            <span class="text-xs font-bold">${compliancePercent}%</span>
                            <div class="w-full bg-gray-200 rounded-full h-2 max-w-[80px]">
                                <div class="h-2 rounded-full" style="width: ${compliancePercent}%; background-color: ${barColor};"></div>
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
            devTasksValid = devTasksList.every(t => ['Closed', 'Resolved'].includes(t['State']));
        }
        if (devTasksValid) passedCount++;

        const testTasksList = story.tasks.filter(t => t['Activity'] === 'Testing' || (t['Title'] && (t['Title'].toLowerCase().includes('prep') || t['Title'].toLowerCase().includes('preparation'))));
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
        if (reviews.length > 0) reviewsValid = reviews.every(r => ['Closed', 'Resolved'].includes(r.state));
        if (reviewsValid) passedCount++;

        return {
            passedCount, totalCount,
            priority: priorityValid, iterationPath: iterationPathValid,
            devTasks: devTasksValid, testTasks: testTasksValid,
            testCasesPass: testCasesValid, bugsClosed: bugsValid, reviewsClosed: reviewsValid
        };
    }
};

ui.debouncedRenderActiveCards = debounce(() => ui.renderActiveCards(), 180);
ui.debouncedRenderKanban = debounce(() => ui.renderKanban(), 180);
ui.debouncedRenderDelivery = debounce(() => ui.renderDelivery(), 180);

window.onload = () => {
    ensureDbDefaults(db);
    indexes.rebuildAll();
    const saved = localStorage.getItem('saved_creds');
    if (saved) {
        const creds = JSON.parse(saved);
        document.getElementById('username').value = creds.u;
        document.getElementById('password').value = creds.p;
        document.getElementById('gh-token').value = creds.t;
        document.getElementById('az-pat').value = creds.azPat;
        auth.handleLogin();
    }
};
