document.addEventListener('DOMContentLoaded', () => {
    // --- Navigation ---
    const tabs = document.querySelectorAll('.nav-btn');
    const sections = document.querySelectorAll('.tab-content');

    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const targetId = tab.getAttribute('data-target');

            tabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');

            sections.forEach(s => {
                if (s.id === targetId) {
                    s.classList.add('active');
                } else {
                    s.classList.remove('active');
                }
            });

            // Re-render chart if storage tab selected
            if (targetId === 'storage' && storageChart) {
                storageChart.update();
            }
        });
    });

    // --- Global State ---
    let availableImages = [];
    let storageChart = null;
    const terminal = document.getElementById('terminal');

    function appendToTerminal(text, isError = false) {
        // Remove waiting msg if present
        if (terminal.innerHTML.includes('Waiting for command...')) {
            terminal.innerHTML = '';
        }
        const div = document.createElement('div');
        div.textContent = text;
        if (isError) div.classList.add('text-red-400');

        // Basic syntax highlighting for cache hits/misses
        if (text.includes('[CACHE HIT]')) {
            div.innerHTML = text.replace('[CACHE HIT]', '<span class="text-green-400 font-bold">[CACHE HIT]</span>');
        } else if (text.includes('[CACHE MISS]')) {
            div.innerHTML = text.replace('[CACHE MISS]', '<span class="text-yellow-400 font-bold">[CACHE MISS]</span>');
        } else if (text.includes('Error') || text.includes('Exception') || text.includes('failed')) {
            div.classList.add('text-red-400');
        }

        terminal.appendChild(div);
        terminal.scrollTop = terminal.scrollHeight;
    }

    document.getElementById('btn-clear-term').addEventListener('click', () => {
        terminal.innerHTML = '<div class="text-slate-500 italic">Waiting for command...</div>';
    });

    // --- API Calls ---
    async function loadImages() {
        try {
            const res = await fetch('/api/images');
            availableImages = await res.json();

            // Populate Dropdowns
            const imageSelects = [
                document.getElementById('run-image'),
                document.getElementById('layer-image-select'),
                document.getElementById('storage-image-select'),
                document.getElementById('isolation-image')
            ];

            imageSelects.forEach(select => {
                const currentVal = select.value;
                select.innerHTML = '<option value="">Select Image...</option>';
                availableImages.forEach(img => {
                    const val = `${img.name}:${img.tag}`;
                    const option = document.createElement('option');
                    option.value = val;
                    option.textContent = val;
                    if (val === currentVal) option.selected = true;
                    select.appendChild(option);
                });
            });

            // Populate Images Table
            const tbody = document.getElementById('images-tbody');
            tbody.innerHTML = '';

            if (availableImages.length === 0) {
                tbody.innerHTML = '<tr><td colspan="5" class="py-8 text-center text-slate-500 italic">No images found. Build one first.</td></tr>';
                return;
            }

            availableImages.forEach(img => {
                const date = img.created ? new Date(img.created).toLocaleString() : 'N/A';
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td class="py-3 px-4 font-medium text-white">${img.name}</td>
                    <td class="py-3 px-4"><span class="bg-blue-900/50 text-blue-300 px-2 py-0.5 rounded text-xs select-all">${img.tag}</span></td>
                    <td class="py-3 px-4 font-mono text-xs text-slate-400 select-all">${img.id || ''}</td>
                    <td class="py-3 px-4 text-xs text-slate-400">${date}</td>
                    <td class="py-3 px-4 text-right space-x-2">
                        <button onclick="inspectImage('${img.name}', '${img.tag}')" class="text-blue-400 hover:text-blue-300 transition" title="Inspect">
                            <i class="fa-solid fa-eye"></i>
                        </button>
                        <button onclick="deleteImage('${img.name}', '${img.tag}')" class="text-red-400 hover:text-red-300 transition" title="Delete">
                            <i class="fa-solid fa-trash"></i>
                        </button>
                    </td>
                `;
                tbody.appendChild(tr);
            });

        } catch (e) {
            console.error('Failed to load images:', e);
        }
    }

    document.getElementById('btn-refresh-images').addEventListener('click', loadImages);

    // Initial Load
    loadImages();

    // --- Dashboard: Build & Run ---
    document.getElementById('btn-build').addEventListener('click', async () => {
        const tag = document.getElementById('build-tag').value.trim() || 'myapp:latest';
        const context = document.getElementById('build-context').value.trim() || 'sample_app';
        const no_cache = document.getElementById('build-nocache').checked;

        const btn = document.getElementById('btn-build');
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Building...';

        appendToTerminal(`\n--- Build started for ${tag} (Context: ${context}) ---`);

        try {
            const response = await fetch('/api/build', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ tag, context, no_cache })
            });

            const reader = response.body.getReader();
            const decoder = new TextDecoder("utf-8");

            while (true) {
                const { value, done } = await reader.read();
                if (done) break;

                const chunk = decoder.decode(value);
                const lines = chunk.split('\n');
                lines.forEach(line => {
                    if (line.startsWith('data: ')) {
                        const content = line.substring(6);
                        if (content.trim()) appendToTerminal(content);
                    }
                });
            }
        } catch (e) {
            appendToTerminal(`Error starting build: ${e.message}`, true);
        } finally {
            btn.disabled = false;
            btn.innerHTML = 'Run Build';
            loadImages(); // Refresh image list
        }
    });

    document.getElementById('btn-run').addEventListener('click', async () => {
        const image = document.getElementById('run-image').value;
        if (!image) { alert("Select an image first"); return; }

        const envStr = document.getElementById('run-env').value;
        const env = envStr ? envStr.split(',').map(e => e.trim()).filter(e => e) : [];
        const command = document.getElementById('run-cmd').value;

        const btn = document.getElementById('btn-run');
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Running...';

        appendToTerminal(`\n--- Running container from ${image} ---`);

        try {
            const response = await fetch('/api/run', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ image, env, command })
            });

            const reader = response.body.getReader();
            const decoder = new TextDecoder("utf-8");

            while (true) {
                const { value, done } = await reader.read();
                if (done) break;

                const chunk = decoder.decode(value);
                const lines = chunk.split('\n');
                lines.forEach(line => {
                    if (line.startsWith('data: ')) {
                        const content = line.substring(6);
                        if (content.trim()) appendToTerminal(content);
                    }
                });
            }
        } catch(e) {
            appendToTerminal(`Error running container: ${e.message}`, true);
        } finally {
            btn.disabled = false;
            btn.innerHTML = 'Start Container';
        }
    });

    // --- Isolation Test ---
    document.getElementById('btn-run-isolation').addEventListener('click', async () => {
        const image = document.getElementById('isolation-image').value;
        if (!image) { alert("Select an image first"); return; }

        const btn = document.getElementById('btn-run-isolation');
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Executing...';

        const icon = document.getElementById('isolation-result-icon');
        const title = document.getElementById('isolation-result-title');
        const desc = document.getElementById('isolation-result-desc');
        const badge = document.getElementById('isolation-status-badge');

        icon.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i>';
        icon.className = "text-6xl text-blue-400 mb-4";
        title.innerText = "Running Process...";
        title.className = "text-lg font-bold text-white mb-2";
        desc.innerText = "Executing touch command inside namespace-isolated container rootfs.";
        badge.innerText = "TESTING";
        badge.className = "px-2 py-1 rounded text-xs font-bold bg-blue-900/50 text-blue-400";

        try {
            const res = await fetch('/api/isolation', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ image })
            });
            const data = await res.json();

            if (data.isolation_successful) {
                icon.innerHTML = '<i class="fa-solid fa-shield-check"></i>';
                icon.className = "text-6xl text-emerald-500 mb-4 drop-shadow-[0_0_15px_rgba(16,185,129,0.5)]";
                title.innerText = "Isolation Successful";
                title.className = "text-lg font-bold text-emerald-400 mb-2";
                desc.innerHTML = `Container exited with code <b>${data.exit_code}</b>.<br>The file <b>/HACKED_HOST_FILE.txt</b> was successfully confined to the container rootfs and did NOT leak to the host.`;
                badge.innerText = "SECURE";
                badge.className = "px-2 py-1 rounded text-xs font-bold bg-emerald-900/50 text-emerald-400 border border-emerald-800";
            } else {
                icon.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i>';
                icon.className = "text-6xl text-red-500 mb-4 drop-shadow-[0_0_15px_rgba(239,68,68,0.5)]";
                title.innerText = "Isolation Failed!";
                title.className = "text-lg font-bold text-red-400 mb-2";
                desc.innerHTML = `Warning! The file leaked onto the host filesystem. Check namespaces configuration.`;
                badge.innerText = "VULNERABLE";
                badge.className = "px-2 py-1 rounded text-xs font-bold bg-red-900/50 text-red-400 border border-red-800";
            }
        } catch (e) {
            title.innerText = "Error";
            desc.innerText = e.message;
        } finally {
            btn.disabled = false;
            btn.innerHTML = '<i class="fa-solid fa-shield-halved"></i> Run Process Isolation Test';
        }
    });

    // --- Layer Visualization & Storage ---
    document.getElementById('layer-image-select').addEventListener('change', async (e) => {
        const val = e.target.value;
        const container = document.getElementById('layer-flow-container');
        if (!val) {
            container.innerHTML = '<div class="text-slate-500 italic mt-10">Select an image to view its layers.</div>';
            return;
        }

        const [name, tag] = val.split(':');
        try {
            const res = await fetch(`/api/layers/${name}/${tag}`);
            const data = await res.json();

            if (data.error) {
                container.innerHTML = `<div class="text-red-400 mt-10">${data.error}</div>`;
                return;
            }

            container.innerHTML = '';

            data.layers.forEach((layer, idx) => {
                const isBase = idx === 0;

                // Parse instruction type safely
                let instruction = "SYSTEM";
                let cmdDetails = layer.createdBy || "Base Layer";
                let instrColor = "text-slate-400";

                if (cmdDetails.startsWith("COPY")) { instruction = "COPY"; instrColor = "text-blue-400"; }
                else if (cmdDetails.startsWith("RUN")) { instruction = "RUN"; instrColor = "text-emerald-400"; }
                else if (cmdDetails.toLowerCase().includes("base")) { instruction = "FROM"; instrColor = "text-purple-400"; }

                // Clean up string for display
                if (instruction !== "FROM" && instruction !== "SYSTEM") {
                    cmdDetails = cmdDetails.substring(instruction.length).trim();
                }

                const node = document.createElement('div');
                node.className = 'layer-node';
                node.innerHTML = `
                    <div class="flex justify-between items-start mb-2">
                        <span class="font-bold font-mono ${instrColor}">${instruction}</span>
                        <span class="text-xs text-slate-500 font-mono">${(layer.size / 1024).toFixed(1)} KB</span>
                    </div>
                    <div class="text-sm text-slate-300 font-mono break-all mb-3">${cmdDetails}</div>
                    <div class="text-[10px] text-slate-600 font-mono flex items-center gap-1 border-t border-slate-700/50 pt-2">
                        <i class="fa-solid fa-fingerprint"></i> ${layer.digest.substring(0,20)}...
                    </div>
                `;

                container.appendChild(node);

                if (idx < data.layers.length - 1) {
                    const conn = document.createElement('div');
                    conn.className = 'layer-connector flex items-center justify-center';
                    conn.innerHTML = '<i class="fa-solid fa-arrow-down text-slate-600 text-[10px] mt-4"></i>';
                    container.appendChild(conn);
                }
            });

        } catch (e) {
            container.innerHTML = `<div class="text-red-400 mt-10">Failed to load layer data.</div>`;
        }
    });

    document.getElementById('storage-image-select').addEventListener('change', async (e) => {
        const val = e.target.value;
        const totalEl = document.getElementById('storage-total');
        const countEl = document.getElementById('storage-count');

        if (!val) {
            totalEl.innerText = '-- MB';
            countEl.innerText = '-- Layers';
            if (storageChart) storageChart.destroy();
            return;
        }

        const [name, tag] = val.split(':');
        try {
            const res = await fetch(`/api/layers/${name}/${tag}`);
            const data = await res.json();

            totalEl.innerText = (data.total_size / (1024 * 1024)).toFixed(2) + ' MB';
            countEl.innerText = `${data.layers.length} Layers`;

            const labels = [];
            const sizes = [];
            const bgColors = [];

            data.layers.forEach((l, i) => {
                let inst = l.createdBy ? l.createdBy.split(' ')[0] : 'BASE';
                labels.push(`L${i}: ${inst}`);
                sizes.push(l.size / 1024); // Size in KB

                if (inst === 'COPY') bgColors.push('rgba(96, 165, 250, 0.7)'); // blue
                else if (inst === 'RUN') bgColors.push('rgba(52, 211, 153, 0.7)'); // emerald
                else bgColors.push('rgba(167, 139, 250, 0.7)'); // purple
            });

            const ctx = document.getElementById('storageChart').getContext('2d');
            if (storageChart) storageChart.destroy();

            storageChart = new Chart(ctx, {
                type: 'bar',
                data: {
                    labels: labels,
                    datasets: [{
                        label: 'Layer Size (KB)',
                        data: sizes,
                        backgroundColor: bgColors,
                        borderWidth: 1,
                        borderColor: 'rgba(255,255,255,0.1)'
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { display: false }
                    },
                    scales: {
                        y: {
                            beginAtZero: true,
                            grid: { color: 'rgba(255,255,255,0.05)' },
                            ticks: { color: '#94a3b8' }
                        },
                        x: {
                            grid: { display: false },
                            ticks: { color: '#94a3b8' }
                        }
                    }
                }
            });

        } catch(e) {
            console.error("Failed to load storage data");
        }
    });

});

// Global functions for inline usage
window.inspectImage = async function(name, tag) {
    try {
        const res = await fetch(`/api/inspect/${name}/${tag}`);
        const data = await res.json();

        document.getElementById('inspect-name').innerText = `${data.name}:${data.tag}`;
        document.getElementById('inspect-digest').innerText = data.digest || 'N/A';

        const cmd = data.config && data.config.Cmd ? JSON.stringify(data.config.Cmd, null, 2) : '[]';
        document.getElementById('inspect-cmd').innerText = cmd;

        const workdir = data.config && data.config.WorkingDir ? data.config.WorkingDir : '/';
        document.getElementById('inspect-workdir').innerText = workdir;

        const envs = data.config && data.config.Env ? data.config.Env.join('\n') : 'No environment variables';
        document.getElementById('inspect-env').innerText = envs;

        document.getElementById('inspect-modal').classList.remove('hidden');
    } catch(e) {
        alert("Failed to inspect image: " + e.message);
    }
}

window.deleteImage = async function(name, tag) {
    if (!confirm(`Are you sure you want to delete ${name}:${tag}?`)) return;
    try {
        const res = await fetch(`/api/rmi/${name}/${tag}`, { method: 'DELETE' });
        const data = await res.json();
        if (data.success) {
            alert(`Deleted ${name}:${tag}\n\nOutputs:\n${data.output}`);
            document.getElementById('btn-refresh-images').click(); // reload list
        } else {
            alert(`Failed to delete: ${data.error}`);
        }
    } catch(e) {
        alert("Error calling delete endpoint");
    }
}
