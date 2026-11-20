/**
 * Reusable UI Card & Component Renderers
 */
function renderTagDropdown(storyId, selectedTags = []) {
    const customTagsList = db.customTags || [];
    if (customTagsList.length === 0) return '';
    return `
        <div class="relative inline-block group">
            <button class="w-6 h-6 flex items-center justify-center rounded-full bg-gray-50 border border-gray-200 text-gray-400 hover:bg-indigo-50 hover:text-indigo-600 transition-all pb-0.5">
                <span class="text-sm font-bold">+</span>
            </button>
            <div class="hidden group-hover:block absolute left-0 top-full mt-0 pt-2 w-48 z-[999]">
                <div class="bg-white border border-gray-100 shadow-2xl rounded-lg py-1 overflow-hidden">
                    <div class="px-3 py-1.5 text-[9px] font-bold text-gray-400 border-b border-gray-50 bg-gray-50/50">Select Tag</div>
                    <div class="max-h-40 overflow-y-auto">
                        ${customTagsList.map(tag => {
                            const isPicked = selectedTags.includes(tag);
                            return `
                                <button onclick="tagManager.toggleTagInStory('${storyId}', '${encodeURIComponent(tag)}')" 
                                        class="w-full text-left px-3 py-2 text-[11px] font-medium ${isPicked ? 'bg-purple-50 text-purple-700' : 'text-slate-600 hover:bg-indigo-50 hover:text-indigo-600'} transition-colors flex items-center justify-between">
                                    ${escapeHtml(tag)}
                                    ${isPicked ? '<span class="text-purple-600 font-bold">✓</span>' : ''}
                                </button>
                            `;
                        }).join('')}
                    </div>
                </div>
            </div>
        </div>
    `;
}

function renderComments(story) {
    const comments = getStandupComments(story.id);
    if (!comments.length) return '';
    return `
        <div class="space-y-2 max-h-28 overflow-y-auto pr-1">
            ${comments.slice().reverse().map(c => `
                <div class="bg-white p-2 rounded-lg border border-indigo-100/50 shadow-sm">
                    <div class="flex justify-between items-center mb-1">
                        <span class="text-[9px] font-bold text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded">${escapeHtml(c.date)}</span>
                    </div>
                    <p class="text-[11px] text-slate-600 leading-tight italic">"${escapeHtml(c.text)}"</p>
                </div>
            `).join('')}
        </div>
    `;
}

function createStoryCard(story, options = {}) {
    const {
        mode = 'regular',
        showTagDropdown = true,
        showCommentsButton = true,
        customClass = '',
        showStatus = true,
    } = options;

    const isBacklog = mode === 'backlog';
    const isSupport = mode === 'support';

    const tags = [...new Set([...(story.tags || []), ...(story.customTags || [])])];
    const commentsCount = getStandupComments(story.id).length;
    const releaseDate = story.expectedRelease
        ? (story.expectedRelease instanceof Date ? story.expectedRelease.toLocaleDateString('en-GB') : new Date(story.expectedRelease).toLocaleDateString('en-GB'))
        : null;

    const iterationPathValid = !!(story.iterationPath && /[\d\/]/.test(story.iterationPath));
    const iterationPathIndicator = (!isBacklog && !isSupport)
        ? `<span class="text-[10px] font-bold ${iterationPathValid ? 'text-green-600' : 'text-red-600'} ml-2 inline-flex items-center gap-1 min-w-0 max-w-[240px]" title="${escapeHtml(story.iterationPath || 'N/A')}">
                ${iterationPathValid ? '✅' : '❌'}
                <span class="truncate">IP: ${escapeHtml(story.iterationPath || 'N/A')}</span>
           </span>`
        : '';

    let statusHtml = '';
    if (showStatus && !isBacklog) {
        const state = story.state || '';
        let statusClass = 'status-active';
        if (state === 'Tested') statusClass = 'status-tested';
        else if (state === 'Delayed') statusClass = 'status-delayed';
        else if (state === 'On-Hold') statusClass = 'status-onhold';
        else if (state === 'Closed') statusClass = 'status-closed';
        statusHtml = `<span class="status-badge ${statusClass}">${escapeHtml(state)}</span>`;
    }

    const tagDropdownHtml = showTagDropdown ? renderTagDropdown(story.id, story.customTags || []) : '';
    const commentsHtml = showCommentsButton && !isBacklog
        ? `<button onclick="ui.openCommentsModal('${story.id}')" class="btn btn-outline text-indigo-600 border-indigo-300 hover:bg-indigo-50 text-xs py-1 px-2">💬 <span class="font-bold">${commentsCount}</span></button>`
        : '';

    let extraFields = '';
    if (isBacklog) {
        extraFields = `
            <div class="grid grid-cols-2 gap-2 border-t pt-2 text-[11px]">
                <div><div class="text-gray-400 uppercase font-bold text-[9px]">Area</div><div class="text-slate-700 truncate">${escapeHtml(story.area)}</div></div>
                <div><div class="text-gray-400 uppercase font-bold text-[9px]">Priority</div><div class="text-slate-700 font-bold">P${escapeHtml(story.priority)}</div></div>
            </div>
        `;
    } else if (isSupport) {
        extraFields = `
            <div class="grid grid-cols-2 gap-2 border-t pt-2 text-[11px]">
                <div><div class="text-gray-400 uppercase font-bold text-[9px]">Assigned To</div><div class="text-slate-700 truncate font-medium">${escapeHtml(story.assignedTo)}</div></div>
                <div><div class="text-gray-400 uppercase font-bold text-[9px]">Priority</div><div class="text-slate-700 font-bold">P${escapeHtml(story.priority)}</div></div>
            </div>
            <div class="text-[10px] text-gray-400 mt-2 border-t border-gray-100 pt-1">Area: ${escapeHtml(story.area || "General")} | Updated: ${story.changedDate ? new Date(story.changedDate).toLocaleDateString('en-GB') : 'N/A'}</div>
        `;
    } else {
        const devEst = story.tasks.filter(t => ["Development", "DB Modification"].includes(t['Activity'])).reduce((acc, t) => acc + parseFloat(t['Original Estimation'] || 0), 0);
        const testEst = story.tasks.filter(t => t['Activity'] === 'Testing').reduce((acc, t) => acc + parseFloat(t['Original Estimation'] || 0), 0);
        const totalBugs = story.bugs ? story.bugs.length : 0;
        const completedBugs = story.bugs ? story.bugs.filter(b => ['Closed', 'Resolved', 'Cancel'].includes(b['State'])).length : 0;
        const testCases = story.testCases || [];
        const totalTC = testCases.length;
        const completedTC = testCases.filter(tc => ['Pass', 'Fail', 'Not Applicable'].includes(tc.state)).length;

        const totalEst = devEst + testEst;
        const bugEstimate = 0.15 * totalEst;
        const actualBugEffort = (story.bugs || [])
            .filter(b => ['Closed', 'Resolved', 'Cancel'].includes(b['State']))
            .reduce((acc, b) => acc + parseFloat(b['Original Estimation'] || 0), 0);
        let bugColor = 'text-gray-500';
        if (bugEstimate > 0) {
            bugColor = actualBugEffort <= bugEstimate ? 'text-google-green' : 'text-google-red';
        }

        extraFields = `
            <div class="grid grid-cols-2 gap-2 border-t pt-2">
                <div class="text-[11px]">
                    <div class="text-gray-400 uppercase font-bold text-[9px]">Dev</div>
                    <div class="text-slate-700 truncate font-medium">${escapeHtml(story.assignedTo)}</div>
                    <div class="flex justify-between items-center mt-1">
                        <span class="text-blue-500 font-bold">${devEst}h</span>
                        <span class="text-red-500 text-[10px] font-bold">🐞${completedBugs}/${totalBugs}</span>
                    </div>
                </div>
                <div class="text-[11px] border-l pl-2">
                    <div class="text-gray-400 uppercase font-bold text-[9px]">Tester</div>
                    <div class="text-slate-700 truncate font-medium">${escapeHtml(story.tester)}</div>
                    <div class="flex justify-between items-center mt-1">
                        <span class="text-green-500 font-bold">${testEst}h</span>
                        <span class="text-indigo-500 text-[10px] font-bold">📋${completedTC}/${totalTC}</span>
                    </div>
                </div>
            </div>
            <div class="flex justify-between items-center mt-2 pt-2 border-t border-gray-200 text-[10px]">
                <span class="font-bold text-gray-500">🐞 Bug Estimate (15%):</span>
                <span class="font-mono">${bugEstimate.toFixed(1)}h</span>
                <span class="font-bold text-gray-500">Actual:</span>
                <span class="font-mono">${actualBugEffort.toFixed(1)}h</span>
                <span class="font-bold ${bugColor}">${bugEstimate > 0 ? ((actualBugEffort / bugEstimate) * 100).toFixed(0) : 0}%</span>
            </div>
        `;
    }

    const borderClass = isBacklog ? 'border-purple-200' : (isSupport ? 'border-gray-200' : 'border-gray-100');

    return `
        <div class="card relative p-3 ${borderClass} hover:border-google-blue ${customClass}">
            ${releaseDate ? `<div class="absolute top-0 right-0 bg-purple-700 text-white text-xs font-bold px-3 py-1.5 rounded-bl-lg shadow-lg z-10 border border-white/20 backdrop-blur-sm">📅 ${escapeHtml(releaseDate)}</div>` : ''}
            ${tags.length > 0 ? `<div class="flex flex-wrap gap-1 mb-2">${tags.map(tag => `<span class="px-1.5 py-0.5 rounded text-[8px] font-bold uppercase tracking-tighter ${(story.customTags || []).includes(tag) ? 'bg-purple-200 text-purple-700 border border-purple-300' : 'bg-slate-100 text-slate-500 border border-slate-200'}">${escapeHtml(tag.trim())}</span>`).join('')}</div>` : ''}
            ${tagDropdownHtml}
            <div class="flex justify-between items-center mb-2 gap-2">
                <div onclick="ui.openStoryModal('${story.id}')" class="text-[10px] font-bold text-google-blue cursor-pointer hover:underline flex items-center gap-0.5 min-w-0 flex-1">
                    #${story.id} 🔍
                    ${iterationPathIndicator}
                </div>
                ${commentsHtml}
            </div>
            <div onclick="ui.openStoryModal('${story.id}')" class="text-sm font-semibold text-slate-800 mb-3 line-clamp-2 cursor-pointer hover:text-google-blue transition">${escapeHtml(story.title)}</div>
            ${extraFields}
        </div>
    `;
}
