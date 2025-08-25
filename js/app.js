const API_CONFIG = {
    dev: {
        tm: 'https://tm-prod.skshitizraj.workers.dev/api/v2',
        fair: 'https://fair-dev.hotosm.org/api/v1'
    },
    prod: {
        tm: 'https://tm-prod.skshitizraj.workers.dev/api/v2',
        fair: 'https://api-prod.fair.hotosm.org/api/v1'
    }
};

const MODEL_OPTIONS = {
    ramp: 'https://api-prod.fair.hotosm.org/api/v1/workspace/download/ramp/baseline.tflite',
    yolo: 'https://api-prod.fair.hotosm.org/api/v1/workspace/download/yolo/yolov8s_v2-seg.onnx'
};

let map;
let currentProject = null;
let currentEnvironment = 'dev';
let predictionData = null;
let taskStats = null;
let userToken = localStorage.getItem('fairAccessToken');
let currentUser = null;

function getImageryTileUrl(imagery) {
    const MAPBOX_ACCESS_TOKEN = null;

    const tileUrls = {
        Bing: "https://ecn.t{s}.tiles.virtualearth.net/tiles/a{q}.jpeg?g=1",
        Mapbox: MAPBOX_ACCESS_TOKEN
            ? `https://{s}.tiles.mapbox.com/v4/mapbox.satellite/{z}/{x}/{y}@2x.jpg?access_token=${MAPBOX_ACCESS_TOKEN}`
            : null,
        EsriWorldImagery: "https://services.arcgisonline.com/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}?blankTile=false",
        "Maxar-Standard": "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
    };
    return tileUrls[imagery] || tileUrls["EsriWorldImagery"];
}

function getProjectImageryUrl(project) {
    if (project?.customEditor?.imagery) {
        return project.customEditor.imagery;
    }
    return null;
}

function processGeometry(geometry) {
    if (!geometry) return null;

    if (geometry.type === 'Polygon') {
        return geometry;
    }

    if (geometry.type === 'MultiPolygon') {
        try {
            const polygons = geometry.coordinates.map(coords => ({
                type: 'Feature',
                geometry: { type: 'Polygon', coordinates: coords }
            }));

            let result = polygons[0];
            for (let i = 1; i < polygons.length; i++) {
                result = turf.union(result, polygons[i]);
            }
            return result.geometry;
        } catch (error) {
            console.warn('Failed to union MultiPolygon, using bounding box');
            const bbox = turf.bbox(geometry);
            return turf.bboxPolygon(bbox).geometry;
        }
    }

    if (geometry.type === 'FeatureCollection') {
        try {
            const features = geometry.features.filter(f =>
                f.geometry && (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon')
            );
            if (features.length === 0) return null;

            let result = features[0];
            for (let i = 1; i < features.length; i++) {
                result = turf.union(result, features[i]);
            }
            return result.geometry;
        } catch (error) {
            console.warn('Failed to union FeatureCollection, using bounding box');
            const bbox = turf.bbox(geometry);
            return turf.bboxPolygon(bbox).geometry;
        }
    }

    try {
        const bbox = turf.bbox(geometry);
        return turf.bboxPolygon(bbox).geometry;
    } catch (error) {
        console.error('Failed to process geometry:', error);
        return null;
    }
}

function initializeApp() {
    setupEventListeners();
    initializeMap();
    checkAuthentication();
    checkUrlParameters();

    document.getElementById('environmentSelect').value = currentEnvironment;
    document.getElementById('environmentSelectMobile').value = currentEnvironment;
}

function checkUrlParameters() {
    const urlParams = new URLSearchParams(window.location.search);
    const hashParams = new URLSearchParams(window.location.hash.substring(1));

    const projectId = urlParams.get('project') || hashParams.get('project');
    const environment = urlParams.get('env') || hashParams.get('env');

    if (environment && (environment === 'dev' || environment === 'prod')) {
        currentEnvironment = environment;
        document.getElementById('environmentSelect').value = currentEnvironment;
        document.getElementById('environmentSelectMobile').value = currentEnvironment;
    }

    if (projectId) {
        document.getElementById('projectIdInput').value = projectId;
        setTimeout(() => {
            loadProject();
        }, 1000);
    }
}

function updateUrl(projectId, environment = null) {
    const url = new URL(window.location);

    if (projectId) {
        url.searchParams.set('project', projectId);
    } else {
        url.searchParams.delete('project');
    }

    if (environment) {
        url.searchParams.set('env', environment);
    }

    window.history.pushState({}, '', url);
}

async function checkAuthentication() {
    if (userToken) {
        try {
            const config = API_CONFIG[currentEnvironment];
            const response = await axios.get(`${config.fair}/auth/me/`, {
                headers: { 'access-token': userToken }
            });
            currentUser = response.data;
            updateUserInterface();
        } catch (error) {
            userToken = null;
            localStorage.removeItem('fairAccessToken');
            showAuthPrompt();
        }
    } else {
        showAuthPrompt();
    }
}

function updateUserInterface() {
    if (currentUser) {
        document.getElementById('authSection').innerHTML = `
            <div class="flex items-center space-x-3">
                <img src="${currentUser.img_url}" alt="Profile" class="w-8 h-8 rounded-full">
                <span class="text-sm text-red-700">${currentUser.username}</span>
                <button onclick="logout()" class="px-2 py-1 text-xs bg-red-600 text-white rounded hover:bg-red-700 transition-colors">
                    Logout
                </button>
            </div>
        `;
    }
}

function showAuthPrompt() {
    const settingsUrl = getFairSettingsUrl();
    const authHtml = `
        <div class="flex flex-col sm:flex-row sm:items-center space-y-2 sm:space-y-0 sm:space-x-3">
            <div class="flex items-center space-x-2">
                <input type="password" id="tokenInput" placeholder="Enter fAIr Access Token" 
                       class="px-3 py-1 text-sm border border-red-200 rounded flex-1 sm:flex-none">
                <button onclick="authenticate()" class="px-3 py-1 text-sm bg-red-600 text-white rounded hover:bg-red-700 whitespace-nowrap">
                    Login
                </button>
            </div>
            <div class="text-xs text-gray-600 text-center sm:text-left">
                Get token 
                <a href="${settingsUrl}" target="_blank" class="text-red-600 hover:text-red-700 underline">
                    here
                </a>
            </div>
        </div>
    `;
    document.getElementById('authSection').innerHTML = authHtml;
}

async function authenticate() {
    const token = document.getElementById('tokenInput').value.trim();
    if (!token) return;

    try {
        const config = API_CONFIG[currentEnvironment];
        const response = await axios.get(`${config.fair}/auth/me/`, {
            headers: { 'access-token': token }
        });

        userToken = token;
        currentUser = response.data;
        localStorage.setItem('fairAccessToken', token);
        updateUserInterface();
    } catch (error) {
        alert('Invalid access token');
    }
}

function logout() {
    userToken = null;
    currentUser = null;
    localStorage.removeItem('fairAccessToken');
    showAuthPrompt();
}

function setupEventListeners() {
    document.getElementById('loadProjectBtn').addEventListener('click', loadProject);

    const environmentSelect = document.getElementById('environmentSelect');
    const environmentSelectMobile = document.getElementById('environmentSelectMobile');

    const handleEnvironmentChange = (e) => {
        currentEnvironment = e.target.value;
        environmentSelect.value = currentEnvironment;
        environmentSelectMobile.value = currentEnvironment;
        checkAuthentication();

        const projectId = currentProject ? currentProject.projectId : null;
        updateUrl(projectId, currentEnvironment);
    };

    environmentSelect.addEventListener('change', handleEnvironmentChange);
    environmentSelectMobile.addEventListener('change', handleEnvironmentChange);

    document.getElementById('projectIdInput').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') loadProject();
    });
    document.getElementById('cancelGenerate').addEventListener('click', closeGenerateModal);
    document.getElementById('confirmGenerate').addEventListener('click', generatePredictions);
    document.getElementById('showPredictionsToggle').addEventListener('change', togglePredictions);
    document.getElementById('downloadStats').addEventListener('click', downloadTaskStats);
    document.getElementById('advancedToggle').addEventListener('change', toggleAdvancedSettings);
}

function toggleAdvancedSettings() {
    const toggle = document.getElementById('advancedToggle');
    const settings = document.getElementById('advancedSettings');
    settings.classList.toggle('hidden', !toggle.checked);
}

function initializeMap() {
    let protocol = new pmtiles.Protocol();
    maplibregl.addProtocol("pmtiles", protocol.tile);

    map = new maplibregl.Map({
        container: 'map',
        style: {
            version: 8,
            sources: {
                'osm': {
                    type: 'raster',
                    tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
                    tileSize: 256
                }
            },
            layers: [
                {
                    id: 'osm',
                    type: 'raster',
                    source: 'osm'
                }
            ]
        },
        center: [0, 0],
        zoom: 2
    });

    map.addControl(new maplibregl.NavigationControl(), 'top-right');

    map.on('click', 'project-tasks-fill', (e) => {
        if (e.features.length > 0) {
            const task = e.features[0];
            const props = task.properties;

            new maplibregl.Popup()
                .setLngLat(e.lngLat)
                .setHTML(`
                    <div class="p-2">
                        <h4 class="font-semibold">Task ${props.taskId}</h4>
                        <p class="text-sm text-gray-600">Status: ${props.taskStatus}</p>
                        <p class="text-sm text-gray-600">Buildings: ${props.predictionCount || 0}</p>
                    </div>
                `)
                .addTo(map);
        }
    });

    map.on('mouseenter', 'project-tasks-fill', () => {
        map.getCanvas().style.cursor = 'pointer';
    });

    map.on('mouseleave', 'project-tasks-fill', () => {
        map.getCanvas().style.cursor = '';
    });
}

function clearPreviousProjectData() {
    currentProject = null;
    predictionData = null;
    taskStats = null;

    updateUrl(null, currentEnvironment);

    const elementsToReset = [
        { id: 'projectInfo', action: 'clear' },
        { id: 'predictionStatus', action: 'clear' },
        { id: 'predictionResults', action: 'clear' },
        { id: 'predictionStats', action: 'clear' },
        { id: 'predictionStatsPlaceholder', action: 'show' },
        { id: 'showPredictionsToggle', action: 'uncheck' }
    ];

    const elementsToHide = [
        'projectSection', 'resultsSection', 'predictionStats',
        'mapLegend', 'downloadStats', 'predictionActions'
    ];

    const mapLayers = [
        'predictions-fill', 'predictions-line', 'prediction-points',
        'project-boundary-fill', 'project-boundary-line',
        'project-tasks-fill', 'project-tasks-line'
    ];

    const mapSources = [
        'predictions', 'prediction-points', 'prediction-points-pmtiles', 'project-boundary', 'project-tasks'
    ];

    elementsToReset.forEach(({ id, action }) => {
        const el = document.getElementById(id);
        if (action === 'clear') el.innerHTML = '';
        else if (action === 'show') el.style.display = 'block';
        else if (action === 'uncheck') el.checked = false;
    });

    elementsToHide.forEach(id =>
        document.getElementById(id).classList.add('hidden')
    );

    if (map) {
        mapLayers.forEach(layer => {
            if (map.getLayer(layer)) map.removeLayer(layer);
        });
        mapSources.forEach(source => {
            if (map.getSource(source)) map.removeSource(source);
        });
    }
}

async function loadProject() {
    const projectId = document.getElementById('projectIdInput').value.trim();
    if (!projectId) {
        showError('Please enter a project ID');
        return;
    }

    clearPreviousProjectData();

    setLoadingState(true);

    try {
        const config = API_CONFIG[currentEnvironment];
        const response = await axios.get(`${config.tm}/projects/${projectId}/`);
        currentProject = response.data;

        const tasksResponse = await axios.get(`${config.tm}/projects/${projectId}/tasks/`);
        currentProject.tasks = tasksResponse.data;

        displayProjectInfo(currentProject);
        addProjectToMap(currentProject);

        document.getElementById('projectSection').classList.remove('hidden');

        await checkPredictions(projectId);

        updateUrl(projectId, currentEnvironment);

    } catch (error) {
        const status = document.getElementById('predictionStatus');
        status.innerHTML = `
            <div class="flex items-center">
                <span class="status-dot status-unavailable"></span>
                <span class="text-gray-600">Project not found</span>
            </div>
        `;
        console.error(error);
    } finally {
        setLoadingState(false);
    }
}

function displayProjectInfo(project) {
    const totalTasks = project.tasks?.features?.length || 0;
    const projectUrl = `https://tasks.hotosm.org/projects/${project.projectId}`;
    const info = document.getElementById('projectInfo');
    info.innerHTML = `
        <div class="space-y-3">
            <div>
                <h4 class="font-semibold text-gray-700">Project Name</h4>
                <p class="text-gray-600">${project.projectInfo?.name || 'N/A'}</p>
            </div>
            <div>
                <h4 class="font-semibold text-gray-700">Project ID</h4>
                <a href="${projectUrl}" target="_blank" class="text-red-600 hover:text-red-700 underline font-medium">${project.projectId}</a>
            </div>
            <div>
                <h4 class="font-semibold text-gray-700">Status</h4>
                <span class="px-2 py-1 text-xs rounded-full bg-red-100 text-red-800">${project.status}</span>
            </div>
            <div>
                <h4 class="font-semibold text-gray-700">Priority</h4>
                <span class="px-2 py-1 text-xs rounded-full bg-red-100 text-red-800">${project.projectPriority}</span>
            </div>
            <div>
                <h4 class="font-semibold text-gray-700">Tasks</h4>
                <p class="text-gray-600">${totalTasks} total</p>
            </div>
        </div>
    `;
}

function addProjectToMap(project) {
    if (!project.areaOfInterest) return;

    if (map.getSource('project-boundary')) {
        map.getSource('project-boundary').setData(project.areaOfInterest);
    } else {
        map.addSource('project-boundary', {
            type: 'geojson',
            data: project.areaOfInterest
        });

        map.addLayer({
            id: 'project-boundary-fill',
            type: 'fill',
            source: 'project-boundary',
            paint: {
                'fill-color': '#E8302A',
                'fill-opacity': 0.1
            }
        });

        map.addLayer({
            id: 'project-boundary-line',
            type: 'line',
            source: 'project-boundary',
            paint: {
                'line-color': '#E8302A',
                'line-width': 2
            }
        });
    }

    if (project.tasks) {
        if (map.getSource('project-tasks')) {
            map.getSource('project-tasks').setData(project.tasks);
        } else {
            map.addSource('project-tasks', {
                type: 'geojson',
                data: project.tasks
            });

            map.addLayer({
                id: 'project-tasks-fill',
                type: 'fill',
                source: 'project-tasks',
                paint: {
                    'fill-color': '#f3f4f6',
                    'fill-opacity': 0.7
                }
            });

            map.addLayer({
                id: 'project-tasks-line',
                type: 'line',
                source: 'project-tasks',
                paint: {
                    'line-color': '#9ca3af',
                    'line-width': 1
                }
            });
        }
    }

    const bbox = turf.bbox(project.areaOfInterest);
    map.fitBounds(bbox, { padding: 50 });
}

function getOfflinePredictionsUrl() {
    const baseUrl = currentEnvironment === 'dev' ? 'https://fair-dev.hotosm.org' : 'https://fair.hotosm.org';
    return `${baseUrl}/profile/offline-predictions`;
}

function getFairSettingsUrl() {
    const baseUrl = currentEnvironment === 'dev' ? 'https://fair-dev.hotosm.org' : 'https://fair.hotosm.org';
    return `${baseUrl}/profile/settings`;
}

async function checkPredictions(projectId) {
    const status = document.getElementById('predictionStatus');
    const actions = document.getElementById('predictionActions');

    status.innerHTML = `
        <div class="flex items-center">
            <span class="status-dot status-loading"></span>
            <span class="text-gray-600">Checking predictions...</span>
        </div>
    `;

    try {
        const config = API_CONFIG[currentEnvironment];
        const response = await axios.get(`${config.fair}/workspace/prediction/TM/${currentEnvironment}/${projectId}/`);

        if (response.status === 200) {
            const hasFiles = response.data.file && Object.keys(response.data.file).length > 0;
            const hasDirs = response.data.dir && Object.keys(response.data.dir).length > 0;

            if (hasFiles || hasDirs) {
                status.innerHTML = `
                    <div class="flex items-center justify-between">
                        <div class="flex items-center">
                            <span class="status-dot status-available"></span>
                            <span class="text-gray-600">Loading predictions...</span>
                        </div>
                        <a href="${getOfflinePredictionsUrl()}" target="_blank" class="text-sm text-red-600 hover:text-red-700 underline">
                            My Predictions
                        </a>
                    </div>
                `;

                displayPredictionFiles(response.data);
                await loadPredictions();

                actions.innerHTML = `
                    <button onclick="showRegenerateWarning()" class="px-3 py-1 text-sm bg-amber-600 text-white rounded hover:bg-amber-700 transition-colors">
                        <i class="fas fa-redo mr-1"></i>Regenerate
                    </button>
                `;
                actions.classList.remove('hidden');
            } else {
                throw new Error('Empty predictions');
            }

        } else {
            throw new Error('No predictions');
        }

    } catch (error) {
        status.innerHTML = `
            <div class="flex items-center justify-between">
                <div class="flex items-center">
                    <span class="status-dot status-unavailable"></span>
                    <span class="text-gray-600">No predictions available</span>
                </div>
                <a href="${getOfflinePredictionsUrl()}" target="_blank" class="text-sm text-red-600 hover:text-red-700 underline">
                    My Predictions
                </a>
            </div>
        `;

        actions.innerHTML = `
            <button onclick="showGenerateModal()" class="px-3 py-1 text-sm bg-red-600 text-white rounded hover:bg-red-700 transition-colors">
                <i class="fas fa-brain mr-1"></i>Request
            </button>
        `;
        actions.classList.remove('hidden');
    }
}

function displayPredictionFiles(data) {
    const results = document.getElementById('predictionResults');
    const files = data.file || {};

    let filesHtml = '<div class="grid md:grid-cols-2 gap-4">';
    Object.entries(files).forEach(([filename, fileInfo]) => {
        filesHtml += `
            <div class="border border-red-200 rounded-lg p-4 hover:border-red-300 transition-colors">
                <div class="flex items-center justify-between">
                    <span class="font-medium text-gray-700">${filename}</span>
                    <span class="text-sm text-gray-500">${formatFileSize(fileInfo.size)}</span>
                </div>
                <button onclick="downloadFile('${filename}')" class="mt-2 text-sm text-red-600 hover:text-red-700">
                    Download
                </button>
            </div>
        `;
    });
    filesHtml += '</div>';

    results.innerHTML = filesHtml;
    document.getElementById('resultsSection').classList.remove('hidden');
}

function formatFileSize(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

async function loadPredictions() {
    if (!currentProject) return;

    try {
        const config = API_CONFIG[currentEnvironment];

        const pmtilesUrl = `${config.fair}/workspace/download/prediction/TM/${currentEnvironment}/${currentProject.projectId}/meta.pmtiles`;

        addPredictionsToMapFromPMTiles(pmtilesUrl);

        await loadPredictionCounts();

        document.getElementById('showPredictionsToggle').checked = false;
        if (map.getLayer('prediction-points')) {
            map.setLayoutProperty('prediction-points', 'visibility', 'none');
        }
        document.getElementById('downloadStats').classList.remove('hidden');

        const status = document.getElementById('predictionStatus');
        const actions = document.getElementById('predictionActions');

        status.innerHTML = `
            <div class="flex items-center justify-between">
                <div class="flex items-center">
                    <span class="status-dot status-available"></span>
                    <span class="text-gray-600">Predictions loaded</span>
                </div>
                <a href="${getOfflinePredictionsUrl()}" target="_blank" class="text-sm text-red-600 hover:text-red-700 underline">
                    My Predictions
                </a>
            </div>
        `;

        actions.innerHTML = `
            <button onclick="showRegenerateWarning()" class="px-3 py-1 text-sm bg-amber-600 text-white rounded hover:bg-amber-700 transition-colors">
                <i class="fas fa-redo mr-1"></i>Regenerate
            </button>
        `;
        actions.classList.remove('hidden');

    } catch (error) {
        const status = document.getElementById('predictionStatus');
        status.innerHTML = `
            <div class="flex items-center">
                <span class="status-dot status-unavailable"></span>
                <span class="text-gray-600">Failed to load predictions</span>
            </div>
        `;
        console.error(error);
    }
}

function addPredictionsToMapFromPMTiles(pmtilesUrl) {
    if (map.getLayer('prediction-points')) {
        map.removeLayer('prediction-points');
    }
    if (map.getSource('prediction-points-pmtiles')) {
        map.removeSource('prediction-points-pmtiles');
    }

    map.addSource('prediction-points-pmtiles', {
        type: 'vector',
        url: `pmtiles://${pmtilesUrl}`
    });

    map.addLayer({
        id: 'prediction-points',
        type: 'circle',
        source: 'prediction-points-pmtiles',
        'source-layer': 'labels_points',
        paint: {
            'circle-radius': 3,
            'circle-color': '#0891b2',
            'circle-stroke-color': 'white',
            'circle-stroke-width': 1,
            'circle-opacity': 0.8
        }
    });
}

async function loadPredictionCounts() {
    if (!currentProject?.tasks) return;

    try {
        const config = API_CONFIG[currentEnvironment];

        let response;
        try {
            response = await axios.get(`${config.fair}/workspace/download/prediction/TM/${currentEnvironment}/${currentProject.projectId}/stats.json`);
            if (response.data) {
                processPredictionStats(response.data);
                return;
            }
        } catch (statsError) {
            console.log('Stats endpoint not available, loading GeoJSON for counting...');

            try {
                const fgbUrl = `${config.fair}/workspace/download/prediction/TM/${currentEnvironment}/${currentProject.projectId}/labels_points.fgb`;
                await addChoroplethLayerFromFGB(fgbUrl);
            } catch (fgbError) {
                console.log('FGB format not available, falling back to GeoJSON...');
                try {
                    response = await axios.get(`${config.fair}/workspace/download/prediction/TM/${currentEnvironment}/${currentProject.projectId}/labels_points.geojson/`);
                    predictionData = response.data;
                    await addChoroplethLayer(predictionData);
                } catch (geojsonError) {
                    console.warn('Could not load prediction counts:', geojsonError);
                    displayBasicStats();
                }
            }
        }
    } catch (error) {
        console.error('Error loading prediction counts:', error);
        displayBasicStats();
    }
}

function processPredictionStats(stats) {
    taskStats = stats;

    if (currentProject?.tasks && stats.taskCounts) {
        const tasksWithCounts = {
            ...currentProject.tasks,
            features: currentProject.tasks.features.map((task) => ({
                ...task,
                properties: {
                    ...task.properties,
                    predictionCount: stats.taskCounts[task.properties.taskId] || 0,
                },
            })),
        };

        if (map.getSource('project-tasks')) {
            map.getSource('project-tasks').setData(tasksWithCounts);

            const colorStops = generateColorStops(stats.maxCount);
            map.setPaintProperty('project-tasks-fill', 'fill-color', [
                'interpolate',
                ['linear'],
                ['get', 'predictionCount'],
                ...colorStops
            ]);
        }

        displayPredictionStats(stats);
        createLegend(stats.maxCount);
    }
}

function displayBasicStats() {
    document.getElementById('predictionStats').innerHTML = `
        <div class="bg-red-50 rounded-lg p-4 border border-red-100">
            <div class="text-sm text-center text-red-700">
                Prediction statistics loading...
            </div>
        </div>
    `;
    document.getElementById('predictionStatsPlaceholder').style.display = 'none';
    document.getElementById('predictionStats').classList.remove('hidden');
}

function addPredictionsToMap(geojsonData) {
    if (map.getSource('prediction-points')) {
        map.getSource('prediction-points').setData(geojsonData);
        return;
    }

    map.addSource('prediction-points', {
        type: 'geojson',
        data: geojsonData
    });

    map.addLayer({
        id: 'prediction-points',
        type: 'circle',
        source: 'prediction-points',
        paint: {
            'circle-radius': 3,
            'circle-color': '#0891b2',
            'circle-stroke-color': 'white',
            'circle-stroke-width': 1,
            'circle-opacity': 0.8
        }
    });
}

async function addChoroplethLayerFromFGB(fgbUrl) {
    if (!currentProject?.tasks) return;

    const taskCounts = {};
    let totalPredictions = 0;
    let maxCount = 0;
    let processedTasks = 0;

    try {
        const response = await fetch(fgbUrl);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        for (const task of currentProject.tasks.features) {
            processedTasks++;
            const taskId = task.properties.taskId;
            const bbox = turf.bbox(task.geometry);

            const rect = {
                minX: bbox[0],
                minY: bbox[1],
                maxX: bbox[2],
                maxY: bbox[3]
            };

            try {
                const iter = flatgeobuf.deserialize(response.body, rect);
                let taskCount = 0;

                for await (const feature of iter) {
                    if (turf.booleanPointInPolygon(feature.geometry, task.geometry)) {
                        taskCount++;
                    }
                }

                if (taskCount > 0) {
                    taskCounts[taskId] = taskCount;
                    totalPredictions += taskCount;
                    if (taskCount > maxCount) {
                        maxCount = taskCount;
                    }
                }

            } catch (taskError) {
                console.warn(`Error processing task ${taskId}:`, taskError);
            }

            if (processedTasks % 10 === 0) {
                updateProgressStatus(`${processedTasks}/${currentProject.tasks.features.length} tasks`);
                await new Promise(resolve => setTimeout(resolve, 0));
            }
        }

        const tasksWithCounts = {
            ...currentProject.tasks,
            features: currentProject.tasks.features.map((task) => ({
                ...task,
                properties: {
                    ...task.properties,
                    predictionCount: taskCounts[task.properties.taskId] || 0,
                },
            })),
        };

        taskStats = {
            totalPredictions,
            maxCount,
            tasksWithPredictions: Object.keys(taskCounts).length,
            totalTasks: currentProject.tasks.features.length,
            taskCounts
        };

        if (map.getSource('project-tasks')) {
            map.getSource('project-tasks').setData(tasksWithCounts);

            const colorStops = generateColorStops(maxCount);
            map.setPaintProperty('project-tasks-fill', 'fill-color', [
                'interpolate',
                ['linear'],
                ['get', 'predictionCount'],
                ...colorStops
            ]);
        }

        displayPredictionStats(taskStats);
        createLegend(maxCount);

    } catch (error) {
        console.error('Error processing FGB file:', error);
        throw error;
    }
}

function updateProgressStatus(progressText) {
    const status = document.getElementById('predictionStatus');
    status.innerHTML = `
        <div class="flex items-center">
            <span class="status-dot status-loading"></span>
            <span class="text-gray-600">Processing predictions... ${progressText}</span>
        </div>
    `;
}

async function addChoroplethLayer(predictionData) {
    if (!currentProject?.tasks) return;

    const taskCounts = {};
    let totalPredictions = 0;
    let maxCount = 0;
    let processedFeatures = 0;
    const totalFeatures = predictionData.features.length;

    updateProgressStatus(`0/${totalFeatures.toLocaleString()} features`);

    for (let i = 0; i < predictionData.features.length; i++) {
        const prediction = predictionData.features[i];
        processedFeatures++;

        for (const task of currentProject.tasks.features) {
            try {
                if (turf.booleanPointInPolygon(prediction.geometry, task.geometry)) {
                    const taskId = task.properties.taskId;
                    taskCounts[taskId] = (taskCounts[taskId] || 0) + 1;
                    totalPredictions++;
                    if (taskCounts[taskId] > maxCount) {
                        maxCount = taskCounts[taskId];
                    }
                    break;
                }
            } catch (error) {
                continue;
            }
        }

        if (processedFeatures % 500 === 0) {
            updateProgressStatus(`${processedFeatures.toLocaleString()}/${totalFeatures.toLocaleString()} features`);
            await new Promise(resolve => setTimeout(resolve, 0));
        }
    }

    const tasksWithCounts = {
        ...currentProject.tasks,
        features: currentProject.tasks.features.map((task) => ({
            ...task,
            properties: {
                ...task.properties,
                predictionCount: taskCounts[task.properties.taskId] || 0,
            },
        })),
    };

    taskStats = {
        totalPredictions,
        maxCount,
        tasksWithPredictions: Object.keys(taskCounts).length,
        totalTasks: currentProject.tasks.features.length,
        taskCounts
    };

    if (map.getSource('project-tasks')) {
        map.getSource('project-tasks').setData(tasksWithCounts);

        const colorStops = generateColorStops(maxCount);
        map.setPaintProperty('project-tasks-fill', 'fill-color', [
            'interpolate',
            ['linear'],
            ['get', 'predictionCount'],
            ...colorStops
        ]);
    }

    displayPredictionStats(taskStats);
    createLegend(maxCount);
}

function generateColorStops(maxCount) {
    if (maxCount === 0) return [0, '#fef2f2'];

    const colors = ['#fef2f2', '#fee2e2', '#fecaca', '#fca5a5', '#f87171', '#ef4444', '#dc2626', '#b91c1c'];
    const stops = [];

    for (let i = 0; i <= maxCount; i++) {
        const ratio = i / maxCount;
        const colorIndex = Math.min(Math.floor(ratio * (colors.length - 1)), colors.length - 1);
        stops.push(i, colors[colorIndex]);
    }

    return stops;
}

function displayPredictionStats(stats) {
    const avgBuildings = stats.tasksWithPredictions > 0 ? Math.round(stats.totalPredictions / stats.tasksWithPredictions) : 0;

    document.getElementById('predictionStats').innerHTML = `
        <div class="bg-red-50 rounded-lg p-4 border border-red-100">
            <div class="grid grid-cols-2 gap-4 text-sm">
                <div class="flex justify-between" title="Total predicted buildings across all tasks">
                    <span class="text-red-700">Approx Buildings:</span>
                    <span class="font-semibold text-red-900">${stats.totalPredictions.toLocaleString()}</span>
                </div>
                <div class="flex justify-between" title="Tasks containing at least one predicted building">
                    <span class="text-red-700">Active Tasks:</span>
                    <span class="font-semibold text-red-900">${stats.tasksWithPredictions} / ${stats.totalTasks}</span>
                </div>
                <div class="flex justify-between" title="Highest number of buildings found in a single task">
                    <span class="text-red-700">Peak Density:</span>
                    <span class="font-semibold text-red-900">${stats.maxCount}</span>
                </div>
                <div class="flex justify-between" title="Average buildings per active task">
                    <span class="text-red-700">Average:</span>
                    <span class="font-semibold text-red-900">${avgBuildings}</span>
                </div>
            </div>
        </div>
    `;

    document.getElementById('predictionStatsPlaceholder').style.display = 'none';

    document.getElementById('predictionStats').classList.remove('hidden');
}

function createLegend(maxCount) {
    const legend = document.getElementById('mapLegend');
    const content = document.getElementById('legendContent');

    if (maxCount === 0) {
        legend.classList.add('hidden');
        return;
    }

    const steps = Math.min(5, maxCount);
    const stepSize = Math.ceil(maxCount / steps);
    const colors = ['#fef2f2', '#fee2e2', '#fca5a5', '#f87171', '#dc2626'];

    let legendHtml = '';
    for (let i = 0; i < steps; i++) {
        const value = i * stepSize;
        const nextValue = Math.min((i + 1) * stepSize, maxCount);
        const color = colors[Math.min(i, colors.length - 1)];

        legendHtml += `
            <div class="flex items-center text-xs">
                <div class="w-4 h-3 rounded mr-2 border border-red-200" style="background-color: ${color}"></div>
                <span class="text-red-800">${value === nextValue ? value : `${value}-${nextValue}`}</span>
            </div>
        `;
    }

    content.innerHTML = legendHtml;
    legend.classList.remove('hidden');
}

function togglePredictions(e) {
    const visible = e.target.checked;
    const layers = ['prediction-points'];

    layers.forEach(layer => {
        if (map.getLayer(layer)) {
            map.setLayoutProperty(layer, 'visibility', visible ? 'visible' : 'none');
        }
    });

    const label = document.querySelector('label[for="showPredictionsToggle"] span');
    if (label) {
        label.textContent = visible ? 'Hide Building Points ' : 'Show Building Points ';
    }
}

function downloadTaskStats() {
    if (!taskStats || !currentProject) return;

    const tasksWithStats = {
        type: "FeatureCollection",
        features: currentProject.tasks.features.map((task) => ({
            ...task,
            properties: {
                ...task.properties,
                predictionCount: taskStats.taskCounts[task.properties.taskId] || 0,
            },
        })),
    };

    const jsonContent = JSON.stringify(tasksWithStats, null, 2);
    const blob = new Blob([jsonContent], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const link = document.createElement('a');
    link.href = url;
    link.download = `tm_project_${currentProject.projectId}_tasks_with_stats.geojson`;
    link.click();

    URL.revokeObjectURL(url);
}

function showRegenerateWarning() {
    if (!userToken) {
        alert('Please login first with your fAIr access token');
        return;
    }

    const warningModal = document.createElement('div');
    warningModal.id = 'regenerateWarningModal';
    warningModal.className = 'fixed inset-0 bg-black bg-opacity-50 backdrop-blur-sm z-50 flex items-center justify-center p-4';

    warningModal.innerHTML = `
        <div class="glass-effect rounded-2xl p-6 max-w-md w-full mx-4">
            <div class="text-center mb-6">
                <i class="fas fa-exclamation-triangle text-amber-500 text-4xl mb-3"></i>
                <h3 class="text-xl font-bold text-gray-800 mb-2">Replace Existing Predictions?</h3>
                <p class="text-gray-600">This will replace your current predictions with new ones. This action cannot be undone.</p>
            </div>
            <div class="flex space-x-3">
                <button onclick="closeRegenerateWarning()" class="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors">
                    Cancel
                </button>
                <button onclick="confirmRegenerate()" class="flex-1 px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition-colors">
                    Continue
                </button>
            </div>
        </div>
    `;

    document.body.appendChild(warningModal);
}

function closeRegenerateWarning() {
    const modal = document.getElementById('regenerateWarningModal');
    if (modal) {
        modal.remove();
    }
}

function confirmRegenerate() {
    closeRegenerateWarning();
    showGenerateModal();
}

function showGenerateModal() {
    if (!userToken) {
        alert('Please login first with your fAIr access token');
        return;
    }

    const projectImageryUrl = getProjectImageryUrl(currentProject);
    let defaultImagery = 'Bing';

    if (projectImageryUrl) {
        const imagerySelect = document.getElementById('imagerySelect');
        const customOption = document.createElement('option');
        customOption.value = 'custom';
        customOption.textContent = 'Project Default';
        customOption.selected = true;
        imagerySelect.insertBefore(customOption, imagerySelect.firstChild);
        defaultImagery = 'custom';
    }

    document.getElementById('imagerySelect').value = defaultImagery;
    document.getElementById('generateModal').classList.remove('hidden');
}

function closeGenerateModal() {
    document.getElementById('generateModal').classList.add('hidden');

    const imagerySelect = document.getElementById('imagerySelect');
    const customOption = imagerySelect.querySelector('option[value="custom"]');
    if (customOption) {
        customOption.remove();
    }

    document.getElementById('advancedToggle').checked = false;
    document.getElementById('advancedSettings').classList.add('hidden');
}

async function generatePredictions() {
    if (!currentProject || !userToken) return;

    setGenerateLoadingState(true);

    try {
        const imagery = document.getElementById('imagerySelect').value;
        const model = document.getElementById('modelSelect').value;
        const zoom = parseInt(document.getElementById('zoomSelect').value);

        let imageSource;
        if (imagery === 'custom') {
            imageSource = getProjectImageryUrl(currentProject);
        } else {
            imageSource = getImageryTileUrl(imagery);
        }

        if (!imageSource) {
            imageSource = getImageryTileUrl('Bing');
        }

        const tolerance = parseFloat(document.getElementById('toleranceInput').value);
        const areaThreshold = parseInt(document.getElementById('areaThresholdInput').value);
        const confidence = parseInt(document.getElementById('confidenceInput').value);
        const orthogonalize = document.getElementById('orthogonalizeInput').checked;
        const maxAngleChange = parseInt(document.getElementById('maxAngleInput').value);
        const skewTolerance = parseInt(document.getElementById('skewToleranceInput').value);

        const config = API_CONFIG[currentEnvironment];
        const folder = `TM/${currentEnvironment}/${currentProject.projectId}`;

        const processedGeometry = processGeometry(currentProject.areaOfInterest);
        if (!processedGeometry) {
            throw new Error('Failed to process project geometry');
        }

        const payload = {
            geom: processedGeometry,
            config: {
                tolerance: tolerance,
                area_threshold: areaThreshold,
                orthogonalize: orthogonalize,
                confidence: confidence,
                checkpoint: MODEL_OPTIONS[model],
                ortho_max_angle_change_deg: maxAngleChange,
                zoom_level: zoom,
                ortho_skew_tolerance_deg: skewTolerance,
                source: imageSource,
                folder: folder
            },
            description: `Tasking Manager Project ${currentProject.projectId} - ${currentProject.projectInfo?.name || 'Unknown'}`,
        };

        const response = await axios.post(`${config.fair}/prediction/`, payload, {
            headers: {
                'access-token': userToken,
                'Content-Type': 'application/json'
            }
        });

        if (response.status === 200 || response.status === 201) {
            closeGenerateModal();

            const predictionUrl = getOfflinePredictionsUrl();
            window.open(predictionUrl, '_blank');

            const status = document.getElementById('predictionStatus');
            status.innerHTML = `
                <div class="flex items-center justify-between">
                    <div class="flex items-center">
                        <span class="status-dot status-available"></span>
                        <span class="text-gray-600">Generation successful! Check progress in your fAIr profile and come back.</span>
                    </div>
                    <a href="${predictionUrl}" target="_blank" class="text-sm text-red-600 hover:text-red-700 underline">
                        My Predictions
                    </a>
                </div>
            `;

            setTimeout(() => checkPredictions(currentProject.projectId), 30000);
        }

    } catch (error) {
        const status = document.getElementById('predictionStatus');
        status.innerHTML = `
            <div class="flex items-center">
                <span class="status-dot status-unavailable"></span>
                <span class="text-gray-600">Failed to generate predictions</span>
            </div>
        `;
        console.error(error);
    } finally {
        setGenerateLoadingState(false);
    }
}

function downloadFile(filename) {
    if (!currentProject) return;

    const config = API_CONFIG[currentEnvironment];
    const url = `${config.fair}/workspace/download/prediction/TM/${currentEnvironment}/${currentProject.projectId}/${filename}`;

    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
}

function setLoadingState(loading) {
    const btn = document.getElementById('loadProjectBtn');
    const text = document.getElementById('loadBtnText');
    const spinner = document.getElementById('loadBtnSpinner');

    btn.disabled = loading;
    text.style.display = loading ? 'none' : 'block';
    spinner.style.display = loading ? 'block' : 'none';
}

function setGenerateLoadingState(loading) {
    const btn = document.getElementById('confirmGenerate');
    const text = document.getElementById('generateBtnText');
    const spinner = document.getElementById('generateBtnSpinner');

    btn.disabled = loading;
    text.style.display = loading ? 'none' : 'block';
    spinner.style.display = loading ? 'block' : 'none';
}

document.addEventListener('DOMContentLoaded', initializeApp);
