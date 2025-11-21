// vSAN 9.0 ESA Configuration and Data Models
const DEFAULT_COMPRESSION_BY_TYPE = {
    'full_clone_vdi': { min: 2.0, max: 8.0, default: 4.0 },
    'unstructured': { min: 1.2, max: 2.5, default: 1.6 },
    'oltp_sql': { min: 1.0, max: 1.6, default: 1.2 },
    'encrypted': { min: 1.0, max: 1.05, default: 1.0 },
    'backup': { min: 1.5, max: 3.0, default: 2.0 }
};

const DEFAULT_SIMILARITY = {
    'full_clone_vdi': 0.85,
    'unstructured': 0.35,
    'oltp_sql': 0.15,
    'encrypted': 0.0,
    'backup': 0.5
};

const WORKLOAD_TYPES = {
    'full_clone_vdi': 'VDI Clones',
    'unstructured': 'Unstructured',
    'oltp_sql': 'OLTP/SQL',
    'encrypted': 'Encrypted',
    'backup': 'Backup'
};

// VMware vSAN 9.0 ESA RAID Requirements (OFFICIAL COMPLIANCE)
const VSAN_ESA_RAID_REQUIREMENTS = {
    raid1: { 
        minHosts: 3, 
        overhead: 2.0, 
        description: 'RAID-1 Mirror (FTT=1)',
        esaScheme: '1+1 Mirroring'
    },
    raid5: { 
        minHosts: 3, 
        overhead: 1.25, 
        description: 'RAID-5 Adaptive Erasure Coding (FTT=1)',
        esaScheme: '2+1 or 4+1 Adaptive'
    },
    raid6: { 
        minHosts: 6, 
        overhead: 1.5, 
        description: 'RAID-6 Erasure Coding (FTT=2)',
        esaScheme: '4+2 Erasure Coding'
    }
};

// ESA Platform Limits (vSAN 9.0)
const ESA_LIMITS = {
    maxHosts: 64,
    maxVMsPerHost: 500,
    maxComponentsPerHost: 27000,
    avgComponentsPerVM: 54,
    minNVMeCapacityTiB: 1.6,
    maxNVMeCapacityTiB: 500,
    lfsOverheadPercent: 13.1,
    checksumOverheadPercent: 2.0
};

let workloadCounter = 0;

// Utility functions
function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function safeDiv(a, b) {
    return b === 0 ? 0 : a / b;
}

function domainScalingFactor(hosts, mode) {
    // ESA Global Domain scaling - more aggressive than OSA due to cluster-wide domain
    const cap = mode === 'aggressive' ? 1.0 : mode === 'typical' ? 0.85 : 0.7;
    const k = mode === 'aggressive' ? 0.25 : mode === 'typical' ? 0.20 : 0.15;
    const x = Math.max(0, hosts - 2);
    return cap * (1 - Math.exp(-k * x));
}

function formatNumber(num, decimals = 1) {
    return parseFloat(num).toFixed(decimals);
}

// ESA COMPLIANCE: Dynamic RAID Options Based on Host Count
function updateRaidOptions(hostCount) {
    const raidSelect = document.getElementById('raidLevel');
    const raidWarning = document.getElementById('raidRequirement');
    const currentValue = raidSelect.value;
    
    raidSelect.innerHTML = '';
    
    const availableRaids = [];
    let warnings = [];
    
    // Check each RAID type against vSAN ESA requirements
    Object.entries(VSAN_ESA_RAID_REQUIREMENTS).forEach(([raidType, req]) => {
        if (hostCount >= req.minHosts) {
            availableRaids.push({
                value: raidType,
                label: req.description,
                scheme: req.esaScheme
            });
        } else {
            warnings.push(`${req.description} requires minimum ${req.minHosts} hosts (ESA ${req.esaScheme})`);
        }
    });
    
    // Add available options
    availableRaids.forEach(raid => {
        const option = document.createElement('option');
        option.value = raid.value;
        option.textContent = raid.label;
        raidSelect.appendChild(option);
    });
    
    // Set selection
    if (availableRaids.find(r => r.value === currentValue)) {
        raidSelect.value = currentValue;
    } else {
        const defaultRaid = availableRaids.find(r => r.value === 'raid5') || availableRaids[0];
        if (defaultRaid) {
            raidSelect.value = defaultRaid.value;
        }
    }
    
    // Show warnings
    if (warnings.length > 0 && hostCount < 6) {
        raidWarning.innerHTML = `<strong>ESA RAID Limitations:</strong><br>${warnings.join('<br>')}`;
        raidWarning.classList.remove('hidden');
    } else {
        raidWarning.classList.add('hidden');
    }
    
    return availableRaids.length > 0;
}

// FIXED: Enhanced createWorkloadItem with proper clickable compression checkbox
function createWorkloadItem(type = 'unstructured', logicalTiB = 50, coldPct = 0.6, compressionEnabled = true) {
    const id = workloadCounter++;
    const item = document.createElement('div');
    item.className = 'workload-item';
    item.dataset.id = id;
    
    item.innerHTML = `
        <div class="workload-header">
            <select class="form-control workload-type" data-id="${id}" style="width: 45%;">
                ${Object.entries(WORKLOAD_TYPES).map(([key, label]) => 
                    `<option value="${key}" ${key === type ? 'selected' : ''}>${label}</option>`
                ).join('')}
            </select>
            <label for="workload-compression-${id}" class="workload-compress-label">
                <div class="custom-checkbox">
                    <input type="checkbox" 
                           id="workload-compression-${id}" 
                           class="workload-compression" 
                           data-id="${id}" 
                           ${compressionEnabled ? 'checked' : ''} 
                           title="Per-workload compression via SPBM">
                    <div class="checkmark"></div>
                </div>
                <span>Compress</span>
            </label>
            <button type="button" class="btn btn-danger" onclick="removeWorkload(${id})" title="Remove workload">×</button>
        </div>
        <div class="workload-grid">
            <div class="form-group">
                <label class="form-label">Logical Data (TiB)</label>
                <input type="number" class="form-control workload-logical" data-id="${id}" 
                       value="${logicalTiB}" step="1" min="0">
            </div>
            <div class="form-group">
                <label class="form-label">Cold Data Ratio</label>
                <input type="number" class="form-control workload-cold" data-id="${id}" 
                       value="${coldPct}" step="0.1" min="0" max="1" placeholder="0.0 - 1.0">
            </div>
        </div>
    `;
    
    // Add event listeners for all inputs including compression checkbox
    item.querySelectorAll('input, select').forEach(input => {
        input.addEventListener('input', autoCalculate);
        input.addEventListener('change', autoCalculate);
    });
    
    return item;
}

function addWorkload(type = 'unstructured', logicalTiB = 50, coldPct = 0.6) {
    const container = document.getElementById('workloadsContainer');
    const item = createWorkloadItem(type, logicalTiB, coldPct, true);
    container.appendChild(item);
    autoCalculate();
}

function removeWorkload(id) {
    const item = document.querySelector(`[data-id="${id}"]`);
    if (item) {
        item.style.transform = 'translateX(-100%)';
        item.style.opacity = '0';
        setTimeout(() => {
            item.remove();
            autoCalculate();
        }, 300);
    }
}

// FIXED: Enhanced getWorkloads to properly read compression checkbox state
function getWorkloads() {
    return Array.from(document.querySelectorAll('.workload-item')).map(item => {
        const id = item.dataset.id;
        const typeSelect = item.querySelector('.workload-type');
        const logicalInput = item.querySelector('.workload-logical');
        const coldInput = item.querySelector('.workload-cold');
        const compressionInput = item.querySelector('.workload-compression');
        
        return {
            id: id,
            type: typeSelect ? typeSelect.value : 'unstructured',
            logicalTiB: logicalInput ? parseFloat(logicalInput.value) || 0 : 0,
            coldPct: coldInput ? parseFloat(coldInput.value) || 0 : 0,
            compressionEnabled: compressionInput ? compressionInput.checked : true
        };
    });
}

// ESA COMPLIANCE: Enhanced validation
function validateInputs() {
    const errors = [];
    const warnings = [];
    const hosts = parseInt(document.getElementById('hosts').value) || 0;
    const rawTiBPerHost = parseFloat(document.getElementById('rawTiBPerHost').value) || 0;
    const raidLevel = document.getElementById('raidLevel').value;
    
    // ESA Host limits
    if (hosts < 3) {
        errors.push('vSAN ESA requires minimum 3 hosts for quorum.');
    }
    if (hosts > ESA_LIMITS.maxHosts) {
        errors.push(`vSAN ESA supports maximum ${ESA_LIMITS.maxHosts} hosts per cluster.`);
    }
    
    // ESA RAID validation
    if (raidLevel && VSAN_ESA_RAID_REQUIREMENTS[raidLevel]) {
        const minRequired = VSAN_ESA_RAID_REQUIREMENTS[raidLevel].minHosts;
        if (hosts < minRequired) {
            errors.push(`${VSAN_ESA_RAID_REQUIREMENTS[raidLevel].description} requires minimum ${minRequired} hosts.`);
        }
    }
    
    // ESA NVMe validation
    if (rawTiBPerHost < ESA_LIMITS.minNVMeCapacityTiB) {
        errors.push(`ESA requires minimum ${ESA_LIMITS.minNVMeCapacityTiB} TiB NVMe per host.`);
    }
    if (rawTiBPerHost > ESA_LIMITS.maxNVMeCapacityTiB) {
        warnings.push(`${rawTiBPerHost} TiB per host exceeds typical ESA configurations (${ESA_LIMITS.maxNVMeCapacityTiB} TiB max tested).`);
    }
    
    const workloads = getWorkloads();
    const totalLogical = workloads.reduce((sum, w) => sum + w.logicalTiB, 0);
    if (totalLogical <= 0) errors.push('Total logical dataset must be > 0.');
    
    // ESA VM density validation
    const estimatedVMs = totalLogical / 2; // Rough estimate: 2TiB per VM average
    if (estimatedVMs > (hosts * ESA_LIMITS.maxVMsPerHost)) {
        warnings.push(`Estimated ${Math.round(estimatedVMs)} VMs may exceed ESA limit of ${ESA_LIMITS.maxVMsPerHost} VMs per host.`);
    }
    
    return { errors, warnings };
}

// ESA COMPLIANCE: Complete calculation engine with LFS overhead
function calculateEstimate() {
    const hosts = parseInt(document.getElementById('hosts').value) || 6;
    const rawTiBPerHost = parseFloat(document.getElementById('rawTiBPerHost').value) || 20;
    const raidLevel = document.getElementById('raidLevel').value || 'raid5';
    
    // Physical capacity limits
    const totalRawCapacity = hosts * rawTiBPerHost;
    const raidOverhead = VSAN_ESA_RAID_REQUIREMENTS[raidLevel]?.overhead || 1.25;
    const usableRawCapacity = totalRawCapacity / raidOverhead;
    
    const globalCompressionOn = document.getElementById('compressionOn').checked;
    const domainMode = document.getElementById('domainMode').value || 'typical';
    const lfsOverheadRate = (parseFloat(document.getElementById('lfsOverheadRate').value) || 13.1) / 100;
    const checksumRate = (parseFloat(document.getElementById('checksumRate').value) || 2) / 100;
    
    const workloads = getWorkloads();
    const logicalTotal = workloads.reduce((sum, w) => sum + w.logicalTiB, 0);
    
    if (logicalTotal === 0) {
        throw new Error('No workload data available');
    }
    
    // ESA Phase 1: Per-workload compression (512B granularity) - FIXED
    const perWorkload = workloads.map(w => {
        const compressionProfile = DEFAULT_COMPRESSION_BY_TYPE[w.type] || { default: 1.0 };
        // FIXED: Use individual workload compression setting
        const compressionFactor = (globalCompressionOn && w.compressionEnabled) ? compressionProfile.default : 1.0;
        const compressed = w.logicalTiB / compressionFactor;
        const cold = compressed * clamp(w.coldPct, 0, 1);
        
        return { ...w, compressed, cold, compressionFactor };
    });
    
    const totalCompressed = perWorkload.reduce((sum, p) => sum + p.compressed, 0);
    
    // ESA Phase 2: Global deduplication (4KB blocks, post-processing)
    const domainScaling = domainScalingFactor(hosts, domainMode);
    
    let totalDedupeSavings = 0;
    const perWorkloadFinal = perWorkload.map(p => {
        const similarity = DEFAULT_SIMILARITY[p.type] || 0;
        const dedupeProbability = clamp(similarity * domainScaling, 0, 1);
        // ESA post-processing efficiency - conservative
        const efficiency = (globalCompressionOn && p.compressionEnabled) ? 0.6 : 0.75;
        const dedupeSavings = clamp(p.cold * dedupeProbability * efficiency, 0, p.cold);
        
        totalDedupeSavings += dedupeSavings;
        
        return { ...p, similarity, dedupeSavings, dedupeProbability };
    });
    
    const afterDedupe = totalCompressed - totalDedupeSavings;
    
    // ESA Phase 3: LFS overhead (on object + replica data)
    const replicaData = afterDedupe * (raidOverhead - 1);
    const objectAndReplica = afterDedupe + replicaData;
    const lfsOverhead = objectAndReplica * lfsOverheadRate;
    
    // ESA Phase 4: Checksum overhead
    const checksumOverhead = afterDedupe * checksumRate;
    
    // ESA Final: Net effective capacity
    const netEffective = afterDedupe + lfsOverhead + checksumOverhead;
    
    // Capacity validation and warnings
    const capacityUtilization = (netEffective / usableRawCapacity) * 100;
    const overallReduction = safeDiv(logicalTotal, netEffective);
    const compressionOnly = safeDiv(logicalTotal, totalCompressed);
    const dedupeOnly = safeDiv(totalCompressed, afterDedupe);
    
    // ESA compliance warnings
    const warnings = [];
    const compliance = [];
    
    if (netEffective > usableRawCapacity) {
        warnings.push(`🚨 CAPACITY VIOLATION: Net effective (${formatNumber(netEffective, 1)} TiB) exceeds usable raw (${formatNumber(usableRawCapacity, 1)} TiB)`);
    }
    if (capacityUtilization > 85) {
        warnings.push(`⚠️ HIGH UTILIZATION: ${formatNumber(capacityUtilization, 1)}% of usable capacity (ESA recommends <85%)`);
    }
    if (overallReduction > 8) {
        warnings.push(`⚠️ AGGRESSIVE EFFICIENCY: ${formatNumber(overallReduction, 1)}x reduction may require validation`);
    }
    
    // ESA compliance checks
    if (rawTiBPerHost >= ESA_LIMITS.minNVMeCapacityTiB) {
        compliance.push('✅ ESA NVMe storage requirement met');
    }
    if (hosts >= 3 && hosts <= ESA_LIMITS.maxHosts) {
        compliance.push('✅ ESA host count within supported range');
    }
    if (raidLevel === 'raid5' && hosts >= 3) {
        compliance.push('✅ ESA adaptive RAID-5 configuration supported');
    }
    
    const raidDescription = VSAN_ESA_RAID_REQUIREMENTS[raidLevel]?.description || 'Unknown RAID';
    const esaScheme = VSAN_ESA_RAID_REQUIREMENTS[raidLevel]?.esaScheme || 'Unknown';
    
    return {
        logicalTotal, totalCompressed, afterDedupe, lfsOverhead, checksumOverhead,
        raidOverhead, netEffective, overallReduction, compressionOnly, dedupeOnly,
        perWorkloadFinal, domainScaling, raidLevel, raidDescription, esaScheme,
        totalRawCapacity, usableRawCapacity, capacityUtilization, warnings, compliance,
        replicaData, objectAndReplica,
        notes: [
            `ESA Architecture: ${esaScheme} with ${formatNumber((raidOverhead - 1) * 100, 0)}% overhead`,
            'Global deduplication domain spans entire cluster (no disk groups in ESA)',
            '4KB block deduplication with post-processing (no write-path impact)',
            '512B compression granularity within 4KB blocks (per storage policy)',
            `LFS overhead: ${formatNumber(lfsOverheadRate * 100, 1)}% of object + replica data`,
            `Domain scaling: ${formatNumber(domainScaling, 3)} effectiveness (${hosts} hosts, ${domainMode})`
        ]
    };
}

function updateAnimation(hosts) {
    const container = document.getElementById('animationContainer');
    
    container.querySelectorAll('.host-node').forEach(node => node.remove());
    
    const maxHosts = Math.min(hosts, 6);
    for (let i = 0; i < maxHosts; i++) {
        const node = document.createElement('div');
        node.className = 'host-node';
        node.textContent = i + 1;
        node.style.animationDelay = `${i * 0.3}s`;
        container.appendChild(node);
    }
    
    if (hosts > 6) {
        const node = document.createElement('div');
        node.className = 'host-node';
        node.textContent = `+${hosts - 6}`;
        node.style.fontSize = '0.7rem';
        node.style.animationDelay = '1.8s';
        container.appendChild(node);
    }
}

function createWaterfallChart(result) {
    const svg = document.getElementById('waterfallChart');
    svg.innerHTML = '';
    
    const width = 500;
    const height = 180;
    const margin = { top: 20, right: 20, bottom: 50, left: 50 };
    const chartWidth = width - margin.left - margin.right;
    const chartHeight = height - margin.top - margin.bottom;
    
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    
    const data = [
        { label: 'Raw NVMe', value: result.totalRawCapacity, color: '#64748b', gradient: '#94a3b8' },
        { label: 'Usable Raw', value: result.usableRawCapacity, color: '#6b7280', gradient: '#9ca3af' },
        { label: 'Logical Data', value: result.logicalTotal, color: '#3b82f6', gradient: '#60a5fa' },
        { label: 'Compressed', value: result.totalCompressed, color: '#10b981', gradient: '#34d399' },
        { label: 'After Dedupe', value: result.afterDedupe, color: '#f59e0b', gradient: '#fbbf24' },
        { label: 'Net Effective', value: result.netEffective, color: '#06b6d4', gradient: '#22d3ee' }
    ];
    
    const maxValue = Math.max(...data.map(d => d.value));
    const barWidth = chartWidth / data.length * 0.7;
    const barSpacing = chartWidth / data.length;
    
    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    svg.appendChild(defs);
    
    data.forEach((d, i) => {
        const gradient = document.createElementNS('http://www.w3.org/2000/svg', 'linearGradient');
        gradient.setAttribute('id', `gradient${i}`);
        gradient.setAttribute('x1', '0%');
        gradient.setAttribute('y1', '0%');
        gradient.setAttribute('x2', '0%');
        gradient.setAttribute('y2', '100%');
        
        const stop1 = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
        stop1.setAttribute('offset', '0%');
        stop1.setAttribute('stop-color', d.gradient);
        
        const stop2 = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
        stop2.setAttribute('offset', '100%');
        stop2.setAttribute('stop-color', d.color);
        
        gradient.appendChild(stop1);
        gradient.appendChild(stop2);
        defs.appendChild(gradient);
    });
    
    data.forEach((d, i) => {
        const barHeight = (d.value / maxValue) * chartHeight;
        const x = margin.left + i * barSpacing + (barSpacing - barWidth) / 2;
        const y = margin.top + chartHeight - barHeight;
        
        const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rect.setAttribute('x', x);
        rect.setAttribute('y', y);
        rect.setAttribute('width', barWidth);
        rect.setAttribute('height', barHeight);
        rect.setAttribute('fill', `url(#gradient${i})`);
        rect.setAttribute('rx', '4');
        rect.setAttribute('opacity', i < 2 ? '0.6' : '0.9');
        svg.appendChild(rect);
        
        const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        text.setAttribute('x', x + barWidth / 2);
        text.setAttribute('y', height - 15);
        text.setAttribute('text-anchor', 'middle');
        text.setAttribute('font-size', '10');
        text.setAttribute('fill', '#8a99af');
        text.setAttribute('font-weight', '500');
        text.textContent = d.label;
        svg.appendChild(text);
        
        const valueText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        valueText.setAttribute('x', x + barWidth / 2);
        valueText.setAttribute('y', y - 8);
        valueText.setAttribute('text-anchor', 'middle');
        valueText.setAttribute('font-size', '9');
        valueText.setAttribute('fill', '#64748b');
        valueText.setAttribute('font-weight', '600');
        valueText.textContent = formatNumber(d.value, 0) + ' TiB';
        svg.appendChild(valueText);
    });
}

function displayResults(result) {
    document.getElementById('overallReduction').textContent = formatNumber(result.overallReduction, 1) + 'x';
    document.getElementById('compressionReduction').textContent = formatNumber(result.compressionOnly, 1) + 'x';
    document.getElementById('dedupeReduction').textContent = formatNumber(result.dedupeOnly, 1) + 'x';
    
    // ESA-specific breakdown table
    const breakdownTable = document.getElementById('breakdownTable');
    const hosts = parseInt(document.getElementById('hosts').value) || 6;
    breakdownTable.innerHTML = `
        <tr class="raw-capacity-row"><td>Raw NVMe Capacity</td><td>${formatNumber(result.totalRawCapacity, 1)} TiB</td><td>All-flash NVMe across ${hosts} ESA hosts</td></tr>
        <tr class="raw-capacity-row"><td>Usable Raw Capacity</td><td>${formatNumber(result.usableRawCapacity, 1)} TiB</td><td>After ${result.esaScheme} overhead</td></tr>
        <tr><td>Logical Dataset</td><td>${formatNumber(result.logicalTotal, 1)} TiB</td><td>VM workload data before efficiency</td></tr>
        <tr><td>After ESA Compression</td><td>${formatNumber(result.totalCompressed, 1)} TiB</td><td>512B compression within 4KB blocks</td></tr>
        <tr><td>After ESA Deduplication</td><td>${formatNumber(result.afterDedupe, 1)} TiB</td><td>4KB global post-processing deduplication</td></tr>
        <tr><td>ESA LFS Overhead</td><td>+${formatNumber(result.lfsOverhead, 1)} TiB</td><td>Local File System metadata (${formatNumber((result.lfsOverhead / result.objectAndReplica) * 100, 1)}%)</td></tr>
        <tr><td>Checksum Overhead</td><td>+${formatNumber(result.checksumOverhead, 1)} TiB</td><td>End-to-end data integrity</td></tr>
        <tr class="highlight-row"><td>Net Effective Capacity</td><td>${formatNumber(result.netEffective, 1)} TiB</td><td>Final ESA storage consumption (${formatNumber(result.capacityUtilization, 1)}% utilization)</td></tr>
    `;
    
    // FIXED: Enhanced workload details table with compression status
    const workloadDetailsTable = document.getElementById('workloadDetailsTable');
    workloadDetailsTable.innerHTML = result.perWorkloadFinal.map(w => `
        <tr>
            <td>${WORKLOAD_TYPES[w.type]} ${w.compressionEnabled ? '🗜️' : '➖'}</td>
            <td>${formatNumber(w.logicalTiB, 1)} TiB</td>
            <td>${formatNumber(w.compressed, 1)} TiB</td>
            <td>${formatNumber(w.dedupeSavings, 1)} TiB</td>
            <td>${formatNumber(safeDiv(w.logicalTiB, w.compressed - w.dedupeSavings), 1)}x</td>
        </tr>
    `).join('');
    
    const guidanceNotes = document.getElementById('guidanceNotes');
    guidanceNotes.innerHTML = result.notes.map(note => `<li>${note}</li>`).join('');
    
    createWaterfallChart(result);
    
    showWarnings(result.warnings);
    showESACompliance(result.compliance);
}

function showErrors(errors) {
    const errorDiv = document.getElementById('errors');
    if (errors.length > 0) {
        errorDiv.className = 'alert alert-danger';
        errorDiv.innerHTML = '<strong>⚠️ Configuration Errors:</strong><ul style="margin: 0.5rem 0 0 0; padding-left: 1.2rem;">' + 
            errors.map(error => `<li>${error}</li>`).join('') + '</ul>';
        errorDiv.classList.remove('hidden');
    } else {
        errorDiv.classList.add('hidden');
    }
}

function showWarnings(warnings) {
    const warningDiv = document.getElementById('warnings');
    if (warnings.length > 0) {
        warningDiv.className = 'alert alert-warning';
        warningDiv.innerHTML = '<strong>⚠️ Capacity Warnings:</strong><ul style="margin: 0.5rem 0 0 0; padding-left: 1.2rem;">' + 
            warnings.map(warning => `<li>${warning}</li>`).join('') + '</ul>';
        warningDiv.classList.remove('hidden');
    } else {
        warningDiv.classList.add('hidden');
    }
}

function showESACompliance(compliance) {
    const complianceDiv = document.getElementById('esaCompliance');
    if (compliance.length > 0) {
        complianceDiv.className = 'alert alert-info';
        complianceDiv.innerHTML = '<strong>🏢 ESA Compliance Status:</strong><ul style="margin: 0.5rem 0 0 0; padding-left: 1.2rem;">' + 
            compliance.map(item => `<li>${item}</li>`).join('') + '</ul>';
        complianceDiv.classList.remove('hidden');
    } else {
        complianceDiv.classList.add('hidden');
    }
}

let calculationTimeout;
function autoCalculate() {
    clearTimeout(calculationTimeout);
    calculationTimeout = setTimeout(() => {
        try {
            const validation = validateInputs();
            showErrors(validation.errors);
            
            if (validation.errors.length === 0) {
                const result = calculateEstimate();
                displayResults(result);
            }
        } catch (error) {
            console.error('Calculation error:', error);
            showErrors(['Calculation failed: ' + error.message]);
            showWarnings([]);
            showESACompliance([]);
        }
    }, 200);
}

function handleHostCountChange() {
    const hosts = parseInt(document.getElementById('hosts').value) || 3;
    
    updateRaidOptions(hosts);
    updateAnimation(hosts);
    autoCalculate();
}

document.addEventListener('DOMContentLoaded', function() {
    updateRaidOptions(6);
    
    // Add ESA-representative workloads
    addWorkload('full_clone_vdi', 80, 0.85, true);
    addWorkload('oltp_sql', 60, 0.4, true);
    addWorkload('unstructured', 100, 0.7, true);
    
    document.querySelectorAll('input, select').forEach(input => {
        if (input.id === 'hosts') {
            input.addEventListener('input', handleHostCountChange);
            input.addEventListener('change', handleHostCountChange);
        } else {
            input.addEventListener('input', autoCalculate);
            input.addEventListener('change', autoCalculate);
        }
    });
    
    updateAnimation(6);
    setTimeout(autoCalculate, 200);
});
