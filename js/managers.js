/**
 * Feature Managers: Area Comments, Settings, Tags & Standup Comments
 */
const areaCommentManager = {
    addComment(area, text) {
        if (!area || !text || !text.trim()) return;
        db.areaComments.push({
            area: area,
            text: text.trim(),
            timestamp: new Date().toLocaleString('ar-EG', { hour12: false })
        });
        dataProcessor.saveToGitHub().then(() => {
            ui.renderKanban();
        }).catch(err => {
            console.error('Failed to save area comment:', err);
            ui.showToast('فشل حفظ التعليق: ' + err.message, 'error');
        });
    },

    openCommentsPopup() {
        const modal = document.getElementById('comments-popup');
        if (!modal) return;
        const filterSelect = document.getElementById('kanban-ba-filter');
        const selectedAreas = Array.from(filterSelect.selectedOptions).map(opt => opt.value);
        if (selectedAreas.length === 0) {
            const allStories = [...currentData.filter(s => !isBacklogStory(s) && isRegularStory(s)), ...db.backlogStories];
            const areas = [...new Set(allStories.map(s => s.area || "General"))].sort();
            this.renderCommentsPopup(areas);
        } else {
            this.renderCommentsPopup(selectedAreas);
        }
        modal.classList.remove('hidden');
        document.body.style.overflow = 'hidden';
    },

    closeCommentsPopup() {
        const modal = document.getElementById('comments-popup');
        if (modal) modal.classList.add('hidden');
        document.body.style.overflow = 'auto';
    },

    renderCommentsPopup(areas) {
        const content = document.getElementById('comments-popup-content');
        if (!content) return;
        if (!areas || areas.length === 0) {
            content.innerHTML = `<div class="text-center py-10 text-gray-400">لا توجد مناطق محددة.</div>`;
            return;
        }
        let html = '';
        areas.forEach(area => {
            const comments = db.areaComments.filter(c => c.area === area);
            html += `
                <div class="mb-6 border-b border-gray-100 pb-4 last:border-0">
                    <div class="flex justify-between items-center mb-3">
                        <h4 class="font-bold text-indigo-700 text-sm">📍 ${escapeHtml(area)}</h4>
                        <span class="text-xs text-gray-400">${comments.length} تعليق</span>
                    </div>
                    <div class="space-y-2 max-h-60 overflow-y-auto pr-2">
                        ${comments.length === 0 ? '<p class="text-gray-400 text-xs italic">لا توجد تعليقات في هذه المنطقة.</p>' : ''}
                        ${comments.map((c, index) => `
                            <div class="flex justify-between items-start bg-gray-50 p-3 rounded-lg border border-gray-100 comment-item">
                                <div class="flex-1">
                                    <p class="text-sm text-slate-700" style="direction: rtl; text-align: right;">${escapeHtml(c.text)}</p>
                                    <p class="text-[10px] text-gray-400 mt-1">${escapeHtml(c.timestamp)}</p>
                                </div>
                                <button onclick="areaCommentManager.deleteComment('${encodeURIComponent(area)}', ${index})" class="text-red-400 hover:text-red-600 text-sm font-bold ml-2" title="حذف التعليق">✕</button>
                            </div>
                        `).join('')}
                    </div>
                    <div class="mt-3 flex gap-2">
                        <textarea id="area-comment-${area.replace(/\s/g, '')}" 
                                  placeholder="اكتب تعليق عام عن المنطقة..." 
                                  class="form-input flex-1 resize-none"
                                  rows="1"
                                  style="direction: rtl; text-align: right;"></textarea>
                        <button onclick="areaCommentManager.addCommentFromPopup('${encodeURIComponent(area)}')" 
                                class="btn btn-primary whitespace-nowrap">
                            إضافة
                        </button>
                    </div>
                </div>
            `;
        });
        content.innerHTML = html;
    },

    addCommentFromPopup(area) {
        const decodedArea = decodeURIComponent(area);
        const textarea = document.getElementById(`area-comment-${decodedArea.replace(/\s/g, '')}`);
        if (!textarea) return;
        const text = textarea.value.trim();
        if (!text) return;
        this.addComment(decodedArea, text);
        textarea.value = '';
        this.openCommentsPopup();
    },

    deleteComment(area, index) {
        const decodedArea = decodeURIComponent(area);
        if (!confirm('هل تريد حذف هذا التعليق؟')) return;
        const comments = db.areaComments.filter(c => c.area === decodedArea);
        if (comments[index]) {
            const commentToDelete = comments[index];
            const globalIndex = db.areaComments.indexOf(commentToDelete);
            if (globalIndex > -1) {
                db.areaComments.splice(globalIndex, 1);
                dataProcessor.saveToGitHub().then(() => {
                    this.openCommentsPopup();
                    ui.renderKanban();
                }).catch(err => {
                    console.error('Failed to delete comment:', err);
                    ui.showToast('فشل حذف التعليق: ' + err.message, 'error');
                });
            }
        }
    },

    renderAreaComments() {
        return '';
    }
};

const settings = {
    addUser() {
        const username = document.getElementById('new-user-name').value;
        const password = document.getElementById('new-user-pass').value;
        const role = document.getElementById('new-user-role').value;
        if (!username || !password) return alert("Please fill all fields");
        if (db.users.some(u => u.username === username)) return alert("User already exists");
        db.users.push({ username, password, role });
        dataProcessor.saveToGitHub().then(() => {
            ui.showToast("User added successfully", "success");
            ui.renderSettings();
        });
    },
    removeUser(index) {
        if (db.users[index].username === currentUser.username) return alert("Cannot delete yourself!");
        db.users.splice(index, 1);
        dataProcessor.saveToGitHub();
        ui.renderSettings();
    },
    addVacation() {
        const name = document.getElementById('staff-select').value;
        const date = document.getElementById('vacation-date').value;
        if (!date) return;
        db.vacations.push({ name, date });
        indexes.rebuildCalendar();
        dataProcessor.saveToGitHub();
        ui.renderSettings();
    },
    removeVacation(i) {
        db.vacations.splice(i, 1);
        indexes.rebuildCalendar();
        dataProcessor.saveToGitHub();
        ui.renderSettings();
    },
    addHoliday() {
        const date = document.getElementById('holiday-date').value;
        if (!date) return;
        db.holidays.push(date);
        indexes.rebuildCalendar();
        dataProcessor.saveToGitHub();
        ui.renderSettings();
    },
    removeHoliday(i) {
        db.holidays.splice(i, 1);
        indexes.rebuildCalendar();
        dataProcessor.saveToGitHub();
        ui.renderSettings();
    }
};

const tagManager = {
    addTag() {
        const input = document.getElementById('new-tag-input');
        const tagName = input.value.trim();
        if (!tagName || db.customTags.includes(tagName)) return;
        db.customTags.push(tagName);
        input.value = '';
        dataProcessor.saveToGitHub();
        this.renderTagsSettings();
        ui.renderAll();
    },
    removeTag(tagName) {
        const decoded = decodeURIComponent(tagName);
        db.customTags = db.customTags.filter(t => t !== decoded && t !== tagName);
        db.currentStories.forEach(s => {
            if (s.customTag === decoded || s.customTag === tagName) delete s.customTag;
            if (Array.isArray(s.customTags)) {
                s.customTags = s.customTags.filter(t => t !== decoded && t !== tagName);
            }
        });
        dataProcessor.saveToGitHub();
        this.renderTagsSettings();
        ui.renderAll();
    },
    assignTagToStory(storyId, tagName) {
        const story = findStoryById(storyId);
        if (story) {
            story.customTag = tagName;
            dataProcessor.saveToGitHub();
        }
    },
    renderTagsSettings() {
        const container = document.getElementById('tags-list');
        if (!container) return;
        container.innerHTML = db.customTags.map(tag => `
            <span class="bg-purple-100 text-purple-800 px-3 py-1 rounded-full text-sm font-medium flex items-center gap-2">${escapeHtml(tag)}<button onclick="tagManager.removeTag('${encodeURIComponent(tag)}')" class="text-google-red hover:text-red-700 font-bold">×</button></span>
        `).join('');
    },
    toggleTagInStory(storyId, tagName) {
        const decodedTag = decodeURIComponent(tagName);
        const story = findStoryById(storyId);
        if (story) {
            if (!story.customTags) story.customTags = [];
            const index = story.customTags.indexOf(decodedTag);
            if (index > -1) story.customTags.splice(index, 1);
            else story.customTags.push(decodedTag);
            dataProcessor.saveToGitHub();
            ui.renderAll();
        } else {
            console.error("Story not found in database for ID:", storyId);
        }
    }
};

const commentManager = {
    updateComment(storyId, text) {
        if (!text || !text.trim()) return;
        if (!db.standupCommentsStore) db.standupCommentsStore = {};
        if (!db.standupCommentsStore[storyId]) db.standupCommentsStore[storyId] = [];
        db.standupCommentsStore[storyId].push({
            text: text,
            date: new Date().toLocaleString('en-GB'),
            timestamp: Date.now()
        });
        dataProcessor.saveToGitHub();
        ui.renderAll();
    }
};
