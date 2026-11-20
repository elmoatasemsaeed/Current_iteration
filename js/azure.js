/**
 * Azure DevOps Integration & Story Timeline Manager
 */
const timelineManager = {
    async ensureHistory(storyId) {
        if (!db.workItemHistory) db.workItemHistory = {};
        if (db.workItemHistory[storyId]) return db.workItemHistory[storyId];

        const pat = sessionStorage.getItem('az_pat');
        if (!pat) {
            console.warn('⚠️ No Azure PAT — cannot fetch state history.');
            return null;
        }

        try {
            const authHeader = 'Basic ' + btoa(':' + pat);
            const url = `https://dev.azure.com/${AZURE_CONFIG.ORG}/${AZURE_CONFIG.PROJECT}/_apis/wit/workItems/${storyId}/updates?api-version=6.0`;
            const res = await fetchWithTimeout(url, { headers: { 'Authorization': authHeader } });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);

            const data = await res.json();
            const stateChanges = [];
            (data.value || []).forEach(update => {
                const fields = update.fields || {};
                if (fields['System.State']) {
                    const oldVal = fields['System.State'].oldValue;
                    const newVal = fields['System.State'].newValue;
                    if (oldVal !== newVal && newVal) {
                        let revDate = update.revisedDate;
                        if (!revDate || revDate.toString().startsWith('9999')) {
                            revDate = fields['System.ChangedDate']?.newValue || new Date().toISOString();
                        }
                        stateChanges.push({
                            oldState: oldVal || 'New',
                            newState: newVal,
                            changedDate: revDate,
                            changedBy: update.revisedBy?.displayName || 'Unknown'
                        });
                    }
                }
            });

            db.workItemHistory[storyId] = stateChanges;
            if (currentUser && currentUser.role !== 'viewer') {
                dataProcessor.saveToGitHub().catch(e => console.warn('Failed to save history:', e));
            }
            return stateChanges;
        } catch (e) {
            console.error(`Failed to fetch history for #${storyId}:`, e);
            return null;
        }
    },

    buildSegments(story) {
        const storyHistory = db.workItemHistory?.[story.id] || [];
        const storyIdStr = story.id.toString();
        const prs = (db.pullRequests || [])
            .filter(pr => pr.linkedStoryId && pr.linkedStoryId.toString() === storyIdStr && pr.creationDate)
            .map(pr => ({
                ...pr,
                created: new Date(pr.creationDate),
                closed: pr.closedDate ? new Date(pr.closedDate) : new Date()
            }))
            .sort((a, b) => a.created - b.created);

        const sortedHistory = storyHistory
            .filter(h => h.changedDate)
            .slice()
            .sort((a, b) => new Date(a.changedDate) - new Date(b.changedDate));

        if (sortedHistory.length === 0) return [];

        const now = new Date();
        const rawSegments = [];
        for (let i = 0; i < sortedHistory.length; i++) {
            const change = sortedHistory[i];
            const start = new Date(change.changedDate);
            const end = i + 1 < sortedHistory.length ? new Date(sortedHistory[i + 1].changedDate) : now;
            if (end <= start) continue;
            rawSegments.push({ state: change.newState, start, end, changedBy: change.changedBy });
        }

        let hitFirstResolved = false;
        const classified = [];
        rawSegments.forEach(seg => {
            let phase = null;
            if (seg.state === 'Active' && !hitFirstResolved) {
                phase = 'development';
            } else if (seg.state === 'Resolved') {
                hitFirstResolved = true;
                phase = 'testing';
            } else if (seg.state === 'Active - With Bugs') {
                phase = 'bugfix';
            } else if (seg.state === 'Active' && hitFirstResolved) {
                phase = 'bugfix';
            } else if (seg.state === 'Tested' || seg.state === 'Closed') {
                phase = 'Tested';
            } else if (seg.state === 'On-Hold') {
                phase = 'onhold';
            }
            if (phase) classified.push({ ...seg, phase });
        });

        const finalSegments = [];
        classified.forEach(seg => {
            if (seg.phase !== 'development' && seg.phase !== 'bugfix') {
                finalSegments.push(seg);
                return;
            }

            const prsInPhase = prs.filter(pr => pr.created >= seg.start && pr.created < seg.end);
            if (prsInPhase.length === 0) {
                finalSegments.push(seg);
                return;
            }

            let cursor = seg.start;
            prsInPhase.forEach(pr => {
                const prStart = pr.created > cursor ? pr.created : cursor;
                if (prStart > cursor) {
                    finalSegments.push({
                        phase: seg.phase,
                        subtype: seg.phase === 'development' ? 'development' : 'bugfix',
                        start: cursor,
                        end: prStart
                    });
                }
                const prEnd = pr.closed < seg.end ? pr.closed : seg.end;
                finalSegments.push({
                    phase: seg.phase,
                    subtype: 'review',
                    start: prStart,
                    end: prEnd,
                    pr
                });
                cursor = prEnd;
            });
            if (cursor < seg.end) {
                finalSegments.push({
                    phase: seg.phase,
                    subtype: seg.phase === 'development' ? 'development' : 'bugfix',
                    start: cursor,
                    end: seg.end
                });
            }
        });

        return finalSegments;
    },

    render(story, containerId) {
        const container = document.getElementById(containerId);
        if (!container) return;

        const segments = this.buildSegments(story);
        if (!segments || segments.length === 0) {
            container.innerHTML = `<div class="text-center text-gray-400 text-sm py-4 italic">No state history available for this story yet.</div>`;
            return;
        }

        const colorMap = {
            development: '#3b82f6',
            review: '#f59e0b',
            testing: '#22c55e',
            bugfix: '#ef4444',
            bugreview: '#f97316',
            onhold: '#94a3b8',
            Tested: '#10b981'
        };
        const labelMap = {
            development: 'Development',
            review: 'Code Review',
            testing: 'Testing',
            bugfix: 'Bug Fixing',
            bugreview: 'Bug Review',
            onhold: 'On Hold',
            Tested: 'Tested since'
        };
        const keyOf = (seg) => {
            if (seg.phase === 'development') return seg.subtype === 'review' ? 'review' : 'development';
            if (seg.phase === 'bugfix') return seg.subtype === 'review' ? 'bugreview' : 'bugfix';
            return seg.phase;
        };

        const minDate = Math.min(...segments.map(s => s.start.getTime()));
        const maxDate = Math.max(...segments.map(s => s.end.getTime()));
        const totalDuration = maxDate - minDate || 1;

        const barsHtml = segments.map(seg => {
            const startMs = seg.start.getTime();
            const endMs = seg.end.getTime();
            const leftPct = ((startMs - minDate) / totalDuration) * 100;
            const widthPct = ((endMs - startMs) / totalDuration) * 100;
            const key = keyOf(seg);
            const color = colorMap[key] || '#94a3b8';
            const days = ((endMs - startMs) / (1000 * 60 * 60 * 24)).toFixed(1);
            const title = `${labelMap[key]} — ${seg.start.toLocaleDateString('en-GB')} → ${seg.end.toLocaleDateString('en-GB')} (${days}d)`;
            return `<div class="absolute top-0 h-10 flex items-center justify-center text-white text-[9px] font-bold overflow-hidden border-r border-white/40"
                        style="left:${leftPct}%; width:${widthPct}%; background-color:${color};"
                        title="${escapeHtml(title)}">
                        ${widthPct > 9 ? escapeHtml(labelMap[key]) : ''}
                    </div>`;
        }).join('');

        const startDate = new Date(minDate);
        const totalDays = Math.ceil((maxDate - minDate) / (1000 * 60 * 60 * 24));
        const step = Math.max(1, Math.ceil(totalDays / 8));
        const dateMarkers = [];
        for (let i = 0; i <= totalDays; i += step) {
            const d = new Date(startDate);
            d.setDate(d.getDate() + i);
            const leftPct = ((d.getTime() - minDate) / totalDuration) * 100;
            dateMarkers.push(`<div class="absolute top-12 text-[8px] text-gray-400 transform -translate-x-1/2 whitespace-nowrap" style="left:${leftPct}%">
                ${d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}
            </div>`);
        }

        const uniqueKeys = [...new Set(segments.map(keyOf))];
        const legendHtml = uniqueKeys.map(k => `
            <div class="flex items-center gap-1 text-[10px] font-bold text-slate-600">
                <div class="w-3 h-3 rounded-sm" style="background-color:${colorMap[k]}"></div>
                <span>${escapeHtml(labelMap[k])}</span>
            </div>
        `).join('');

        const detailList = segments.map(seg => {
            const key = keyOf(seg);
            const days = ((seg.end - seg.start) / (1000 * 60 * 60 * 24)).toFixed(1);
            const pr = seg.pr;
            return `<div class="flex justify-between items-center bg-slate-50 rounded-md px-2 py-1 text-[10px] border border-slate-100">
                <span class="flex items-center gap-2">
                    <span class="inline-block w-2.5 h-2.5 rounded-sm" style="background-color:${colorMap[key]}"></span>
                    <span class="font-bold text-slate-700">${escapeHtml(labelMap[key])}</span>
                    ${pr ? `<span class="text-[9px] text-indigo-600 font-mono">#${pr.id}</span>` : ''}
                </span>
                <span class="font-mono text-gray-500">${seg.start.toLocaleDateString('en-GB')} → ${seg.end.toLocaleDateString('en-GB')} <span class="text-slate-700 font-bold">(${days}d)</span></span>
            </div>`;
        }).join('');

        const totalSpan = ((maxDate - minDate) / (1000 * 60 * 60 * 24)).toFixed(1);

        container.innerHTML = `
            <div class="mb-3 flex flex-wrap gap-3 items-center justify-between">
                <div class="flex flex-wrap gap-3">${legendHtml}</div>
                <div class="text-[10px] text-slate-500 font-bold">Total: ${totalSpan} days</div>
            </div>
            <div class="relative bg-slate-50 rounded-lg p-2 pt-2" style="height:72px;">
                <div class="relative h-10 rounded overflow-hidden">${barsHtml}</div>
                ${dateMarkers.join('')}
            </div>
            <div class="mt-3 space-y-1">${detailList}</div>
        `;
    },

    async loadAndRender(story, containerId) {
        const container = document.getElementById(containerId);
        if (!container) return;

        if (db.workItemHistory?.[story.id] !== undefined) {
            this.render(story, containerId);
            return;
        }

        container.innerHTML = `<div class="text-center text-gray-400 text-sm py-4">
            <div class="w-5 h-5 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin mx-auto mb-2"></div>
            Loading state history from Azure...
        </div>`;

        const history = await this.ensureHistory(story.id);
        if (history === null) {
            container.innerHTML = `<div class="text-center text-amber-600 text-sm py-4">⚠️ Could not load history (no Azure PAT or network issue).</div>`;
            return;
        }
        this.render(story, containerId);
    }
};

const azureDevOps = {
    async sync() {
        const pat = sessionStorage.getItem('az_pat');
        if (!pat) {
            ui.showToast("Azure PAT مفقود. الرجاء تسجيل الدخول مجدداً.", "error");
            return;
        }

        const syncBtn = document.querySelector("button[onclick='azureDevOps.sync()']");
        const originalText = syncBtn.innerHTML;
        syncBtn.innerHTML = "⏳ جاري المزامنة...";
        syncBtn.disabled = true;
        ui.showLoader();

        const dbSnapshot = typeof structuredClone === 'function'
            ? structuredClone(db)
            : JSON.parse(JSON.stringify(db));

        try {
            const authHeader = 'Basic ' + btoa(':' + pat);
            const mainQueryUrl = `https://dev.azure.com/${AZURE_CONFIG.ORG}/${AZURE_CONFIG.PROJECT}/_apis/wit/wiql/${AZURE_CONFIG.QUERY_ID}?api-version=6.0`;
            const backlogQueryUrl = AZURE_CONFIG.BACKLOG_QUERY_ID
                ? `https://dev.azure.com/${AZURE_CONFIG.ORG}/${AZURE_CONFIG.PROJECT}/_apis/wit/wiql/${AZURE_CONFIG.BACKLOG_QUERY_ID}?api-version=6.0`
                : null;

            // Fetch Main Query and Backlog Query in parallel
            const [mainRes, backlogRes] = await Promise.all([
                fetchWithTimeout(mainQueryUrl, { headers: { 'Authorization': authHeader } }),
                backlogQueryUrl
                    ? fetchWithTimeout(backlogQueryUrl, { headers: { 'Authorization': authHeader } })
                    : Promise.resolve(null)
            ]);

            if (!mainRes.ok) {
                throw new Error(`فشل الاتصال بـ Azure Main Query (${mainRes.status} ${mainRes.statusText}). تم إلغاء العملية لحماية البيانات.`);
            }
            const mainData = await mainRes.json();
            if (!mainData || mainData.errorCode) {
                throw new Error(`Azure Main Query رجع خطأ: ${mainData?.message || 'Unknown error'}`);
            }
            const mainRelations = mainData.workItemRelations || [];
            const mainIds = [...new Set(mainRelations.map(r => r.target ? r.target.id : null).filter(Boolean))];

            let backlogIds = [];
            if (backlogRes) {
                if (!backlogRes.ok) {
                    throw new Error(`فشل الاتصال بـ Azure Backlog Query (${backlogRes.status}). تم إلغاء العملية.`);
                }
                const backlogData = await backlogRes.json();
                if (backlogData.errorCode) {
                    throw new Error(`Azure Backlog رجع خطأ: ${backlogData.message || 'Unknown'}`);
                }
                if (backlogData.workItemRelations && backlogData.workItemRelations.length > 0) {
                    backlogIds = backlogData.workItemRelations.map(r => r.target ? r.target.id : null).filter(Boolean);
                } else if (backlogData.workItems && backlogData.workItems.length > 0) {
                    backlogIds = backlogData.workItems.map(wi => wi.id).filter(Boolean);
                }
                console.log(`✅ Backlog IDs extracted: ${backlogIds.length}`);
            }

            const allIds = [...new Set([...mainIds, ...backlogIds])];
            if (allIds.length === 0) {
                throw new Error("Azure رجّع 0 عناصر. تم إلغاء المزامنة لحماية البيانات الحالية.");
            }

            // Parallel Batch Fetch (200 items per chunk)
            const chunkSize = 200;
            const batchUrl = `https://dev.azure.com/${AZURE_CONFIG.ORG}/_apis/wit/workitemsbatch?api-version=6.0`;
            const requiredFields = this.getRequiredFields();
            const chunks = [];
            for (let i = 0; i < allIds.length; i += chunkSize) {
                chunks.push(allIds.slice(i, i + chunkSize));
            }

            const batchResults = await Promise.all(chunks.map(async (chunk, idx) => {
                const batchRes = await fetchWithTimeout(batchUrl, {
                    method: 'POST',
                    headers: { 'Authorization': authHeader, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ ids: chunk, fields: requiredFields })
                });
                if (!batchRes.ok) {
                    throw new Error(`فشل استرجاع تفاصيل الـ Work Items (${batchRes.status}). تم إلغاء العملية.`);
                }
                const batchData = await batchRes.json();
                if (batchData.errorCode || !batchData.value) {
                    throw new Error(`Azure Batch رجع خطأ: ${batchData.message || 'Invalid response'}`);
                }
                console.log(`✅ Batch ${idx + 1}: ${batchData.value.length} items loaded`);
                return batchData.value;
            }));

            const allDetails = batchResults.flat();
            if (allDetails.length === 0) {
                throw new Error("لم يتم استلام أي تفاصيل من Azure. تم إلغاء المزامنة.");
            }

            db.workItemsMap = {};
            allDetails.forEach(d => {
                const fields = d.fields || {};
                db.workItemsMap[d.id] = {
                    id: d.id.toString(),
                    type: fields["System.WorkItemType"] || "",
                    area: fields["MyCompany.MyProcess.BusinessArea"] || "",
                    iterationPath: fields["System.IterationPath"] || "",
                    parentId: fields["System.Parent"] ? fields["System.Parent"].toString() : null,
                    title: fields["System.Title"] || ""
                };
            });

            const detailsMap = new Map(allDetails.map(d => [d.id, d.fields]));
            const mainRows = this.buildRowsFromRelations(mainRelations, detailsMap);
            if (mainRows.length === 0) {
                throw new Error("mainRows فاضية. تم إلغاء المزامنة لحماية البيانات.");
            }

            await dataProcessor.processRows(mainRows);

            if (backlogIds.length > 0) {
                const backlogIdSet = new Set(backlogIds);
                const backlogDetails = allDetails.filter(d => backlogIdSet.has(d.id));
                const backlogRows = this.buildBacklogRows(backlogDetails);
                if (backlogRows.length > 0) {
                    await dataProcessor.processBacklogRows(backlogRows);
                } else {
                    console.warn('⚠️ backlogRows فاضية - تم تخطي تحديث الـ backlog.');
                }
            }

            let prCount = 0;
            try {
                const prs = await this.fetchPullRequests(authHeader);
                db.pullRequests = prs;
                prCount = prs.length;
                this.linkPullRequestsToStories();
                await dataProcessor.saveToGitHub();
                console.log(`✅ تم ربط ${prCount} PR بالقصص وحفظها.`);
            } catch (prError) {
                console.warn('⚠️ فشل تحميل الـ Pull Requests (المزامنة الأساسية تمت بنجاح):', prError);
                ui.showToast("⚠️ المزامنة تمت، لكن فشل جلب الـ Pull Requests: " + prError.message, "error");
            }

            ui.showToast(`✅ تمت المزامنة بنجاح! (${prCount} PR محدّث)`, "success");
        } catch (error) {
            console.error("Azure Sync Error:", error);
            db = dbSnapshot;
            indexes.rebuildAll();
            ui.showToast("❌ فشل الاتصال بـ Azure: " + error.message, "error");
        } finally {
            ui.hideLoader();
            syncBtn.innerHTML = originalText;
            syncBtn.disabled = false;
        }
    },

    async fetchPullRequests(authHeader) {
        const url = `https://dev.azure.com/${AZURE_CONFIG.ORG}/${AZURE_CONFIG.PROJECT}/_apis/git/pullrequests?searchCriteria.status=all&$top=500&$expand=WorkItems&api-version=7.1`;
        const res = await fetchWithTimeout(url, { headers: { 'Authorization': authHeader } });

        if (!res.ok) {
            throw new Error(`فشل جلب الـ Pull Requests (${res.status} ${res.statusText}).`);
        }
        const data = await res.json();
        if (!data || !Array.isArray(data.value)) {
            console.warn('⚠️ Azure لم يُرجع أي Pull Requests.');
            return [];
        }

        console.log(`✅ تم استلام ${data.value.length} Pull Request من Azure.`);

        return data.value.map(pr => {
            const creationDate = pr.creationDate ? new Date(pr.creationDate) : null;
            const closedDate = (pr.closedDate && !pr.closedDate.toString().startsWith('9999'))
                ? new Date(pr.closedDate)
                : null;
            let cycleTimeHours = null;
            if (pr.status === 'completed' && creationDate && closedDate) {
                cycleTimeHours = (closedDate.getTime() - creationDate.getTime()) / (1000 * 60 * 60);
            }

            const linkedWorkItemIds = (pr.workItemRefs || []).map(w => w.id.toString());
            let linkedStoryId = linkedWorkItemIds.length > 0 ? linkedWorkItemIds[0] : null;
            if (!linkedStoryId) {
                const titleMatch = (pr.title || '').match(/#?(\d{4,6})/);
                linkedStoryId = titleMatch ? titleMatch[1] : null;
            }

            return {
                id: pr.pullRequestId,
                title: pr.title || '',
                status: pr.status || 'unknown',
                createdBy: pr.createdBy?.displayName || 'Unknown',
                repository: pr.repository?.name || 'N/A',
                creationDate: creationDate ? creationDate.toISOString() : null,
                closedDate: closedDate ? closedDate.toISOString() : null,
                cycleTimeHours: cycleTimeHours,
                linkedStoryId: linkedStoryId,
                linkedWorkItemIds: linkedWorkItemIds,
                sourceRefName: pr.sourceRefName || '',
                targetRefName: pr.targetRefName || '',
                reviewers: (pr.reviewers || []).map(r => ({
                    name: r.displayName || 'Unknown',
                    vote: r.vote != null ? r.vote : 0
                }))
            };
        });
    },

    linkPullRequestsToStories() {
        const allStories = [...(db.currentStories || []), ...(db.backlogStories || [])];
        const storyIdMap = new Map();
        allStories.forEach(s => {
            storyIdMap.set(s.id.toString(), s);
            s.pullRequests = [];
        });

        const findStoryForPR = (pr) => {
            if (pr.linkedStoryId && storyIdMap.has(pr.linkedStoryId.toString())) {
                return storyIdMap.get(pr.linkedStoryId.toString());
            }
            const ids = pr.linkedWorkItemIds || (pr.linkedStoryId ? [pr.linkedStoryId] : []);
            for (const wid of ids) {
                let current = db.workItemsMap?.[wid];
                let depth = 0;
                while (current && depth < 5) {
                    if (storyIdMap.has(current.id.toString())) {
                        return storyIdMap.get(current.id.toString());
                    }
                    if (current.parentId && db.workItemsMap?.[current.parentId]) {
                        current = db.workItemsMap[current.parentId];
                    } else {
                        break;
                    }
                    depth++;
                }
            }
            return null;
        };

        (db.pullRequests || []).forEach(pr => {
            const story = findStoryForPR(pr);
            if (story) story.pullRequests.push(pr);
        });

        console.log(`✅ Linked ${db.pullRequests.length} PRs to stories.`);
    },

    buildRowsFromRelations(relations, detailsMap) {
        const rows = [];
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

    getRequiredFields() {
        return [
            "System.Id", "System.WorkItemType", "System.Title", "System.AssignedTo",
            "Microsoft.VSTS.Common.Activity", "NT.OriginalEstimation",
            "Custom.TimeSheet_DevActualTime", "Custom.TimeSheet_TestingActualTime",
            "Microsoft.VSTS.Common.ActivatedDate", "MyCompany.MyProcess.BusinessArea",
            "System.IterationPath", "Custom.CustomResolvedDate", "MyCompany.MyProcess.TestedDate",
            "MyCompany.MyProcess.Tester", "Microsoft.VSTS.Common.ResolvedDate",
            "System.State", "MyCompany.MyProcess.Release", "MyCompany.MyProcess.BusinessPriority",
            "System.Tags", "System.ChangedDate", "NT.Branch", "Nt.Customer",
            "System.Parent"
        ];
    },

    buildBacklogRows(details) {
        const rows = [];
        details.forEach(d => {
            const fields = d.fields || {};
            const state = fields["System.State"] || "";
            if (!["New", "Approved"].includes(state)) return;
            let area = fields["MyCompany.MyProcess.BusinessArea"] || "";
            if (area && area.trim().toLowerCase() === "integration") area = "LDM Integration";
            if (!area || area.trim() === "") {
                const path = fields["System.IterationPath"] || "";
                area = path.includes('\\') ? path.split('\\')[0] : path;
            }
            rows.push({
                'ID': d.id,
                'Work Item Type': fields["System.WorkItemType"] || "User Story",
                'Title': fields["System.Title"] || "Untitled",
                'Assigned To': fields["System.AssignedTo"]?.displayName || "Unassigned",
                'Business Area': area,
                'State': state,
                'Business Priority': fields["MyCompany.MyProcess.BusinessPriority"] || 999,
                'Release Expected Date': fields["MyCompany.MyProcess.Release"] ? new Date(fields["MyCompany.MyProcess.Release"]) : null,
                'Tags': fields["System.Tags"] || "",
                'Iteration Path': fields["System.IterationPath"] || "",
                'Changed Date': fields["System.ChangedDate"] ? new Date(fields["System.ChangedDate"]) : null
            });
        });
        return rows;
    },

    saveSettings() {
        const settingsObj = {
            org: document.getElementById('az-org').value,
            project: document.getElementById('az-project').value,
            queryId: document.getElementById('az-query-id').value,
            backlogQueryId: document.getElementById('az-backlog-query-id').value
        };
        localStorage.setItem('az_settings', JSON.stringify(settingsObj));
        ui.showToast("تم حفظ إعدادات Azure بنجاح", "success");
    }
};
