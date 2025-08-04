
const FAIR_API_URL = window.FAIR_API_URL || "https://fair-dev.hotosm.org";
const TASKING_MANAGER_API_URL =
    window.TASKING_MANAGER_API_URL ||
    "https://tasking-manager-dev-api.hotosm.org";
const MAPBOX_ACCESS_TOKEN = window.MAPBOX_ACCESS_TOKEN || process.env.MAPBOX_ACCESS_TOKEN;

let map,
    currentProject = null,
    accessToken = localStorage.getItem("fairAccessToken"),
    userInfo = null;

function initMap() {
    map = new maplibregl.Map({
        container: "map",
        style: {
            version: 8,
            sources: {
                osm: {
                    type: "raster",
                    tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
                    tileSize: 256,
                    attribution: "© OpenStreetMap contributors",
                },
            },
            layers: [{ id: "osm", type: "raster", source: "osm" }],
        },
        center: [0, 0],
        zoom: 2,
    });
    map.addControl(new maplibregl.NavigationControl());
    map.on("load", loadProjects);
}

async function loadProjects() {
    try {
        const response = await axios.get(
            `${TASKING_MANAGER_API_URL}/api/v2/projects/`
        );
        // console.log(response.data);
        const projects = response.data.mapResults;
        document.getElementById("loadingProjects").classList.add("hidden");
        document
            .getElementById("projectsContainer")
            .classList.remove("hidden");
        displayProjectsList(projects.features);
        addProjectsToMap(projects.features);
    } catch (error) {
        console.error("Error loading projects:", error);
        document.getElementById("loadingProjects").innerHTML =
            '<p class="text-red-600">Error loading projects</p>';
    }
}

function displayProjectsList(projects) {
    const container = document.getElementById("projectsContainer");
    container.innerHTML = "";
    projects.slice(0, 20).forEach((project) => {
        const projectCard = document.createElement("div");
        projectCard.className =
            "p-3 border border-gray-200 rounded-lg cursor-pointer hover:bg-gray-50 transition-colors";
        projectCard.innerHTML = `
                    <div class="font-medium text-sm">${project.properties.name ||
            `Project ${project.properties.projectId}`
            }</div>
                    <div class="text-xs text-gray-600">ID: ${project.properties.projectId
            }</div>
                `;
        projectCard.onclick = () =>
            loadProjectDetails(project.properties.projectId);
        container.appendChild(projectCard);
    });
}

function addProjectsToMap(projects) {
    const geojson = { type: "FeatureCollection", features: projects };
    map.addSource("projects", { type: "geojson", data: geojson });
    map.addLayer({
        id: "projects-points",
        type: "circle",
        source: "projects",
        paint: {
            "circle-radius": 6,
            "circle-color": "#3b82f6",
            "circle-stroke-color": "white",
            "circle-stroke-width": 2,
        },
    });
    map.on("click", "projects-points", (e) =>
        loadProjectDetails(e.features[0].properties.projectId)
    );
    map.on(
        "mouseenter",
        "projects-points",
        () => (map.getCanvas().style.cursor = "pointer")
    );
    map.on(
        "mouseleave",
        "projects-points",
        () => (map.getCanvas().style.cursor = "")
    );
}

async function loadProjectDetails(projectId) {
    try {
        const response = await axios.get(
            `${TASKING_MANAGER_API_URL}/api/v2/projects/${projectId}/`
        );
        currentProject = response.data;
        displayProjectDetails(currentProject);
        addProjectBoundaryToMap(currentProject);
        document.getElementById("projectDetails").classList.remove("hidden");
        document.getElementById("projectsList").classList.add("hidden");
    } catch (error) {
        console.error("Error loading project details:", error);
    }
}

function displayProjectDetails(project) {
    console.log("Project Details:", project);
    document.getElementById("projectName").textContent =
        project.projectInfo.name;
    document.getElementById("projectDescription").textContent =
        project.projectInfo.shortDescription;
    document.getElementById(
        "percentMapped"
    ).textContent = `${project.percentMapped}%`;
    document.getElementById(
        "percentValidated"
    ).textContent = `${project.percentValidated}%`;

    const statusEl = document.getElementById("projectStatus");
    statusEl.textContent = project.status;
    statusEl.className = `px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(
        project.status
    )}`;

    const priorityEl = document.getElementById("projectPriority");
    priorityEl.textContent = project.projectPriority;
    priorityEl.className = `px-2 py-1 rounded-full text-xs font-medium ml-2 ${getPriorityColor(
        project.projectPriority
    )}`;


    const imagerySource = document.getElementById("imagerySource");
    const imageryLicense = document.getElementById("imageryLicense");


    let imageryText = "Not specified";
    let licenseText = "Not specified";

    if (project.imagery) {
        imageryText = project.imagery;
    } else if (project.projectInfo && project.projectInfo.imagery) {
        imageryText = project.projectInfo.imagery;
    }

    if (project.license) {
        licenseText = project.license;
    } else if (project.projectInfo && project.projectInfo.license) {
        licenseText = project.projectInfo.license;
    } else if (project.licenseId) {
        licenseText = project.licenseId;
    }

    imagerySource.textContent = imageryText;
    imageryLicense.textContent = licenseText;

    displayTaskStats(project.tasks);
}

function displayTaskStats(tasks) {
    const stats = {};
    tasks.features.forEach((task) => {
        const status = task.properties.taskStatus;
        stats[status] = (stats[status] || 0) + 1;
    });
    const container = document.getElementById("taskStats");
    container.innerHTML = "";
    Object.entries(stats).forEach(([status, count]) => {
        const statDiv = document.createElement("div");
        statDiv.className = "flex justify-between text-sm";
        statDiv.innerHTML = `<span class="capitalize">${status
            .toLowerCase()
            .replace(
                "_",
                " "
            )}</span><span class="font-medium">${count}</span>`;
        container.appendChild(statDiv);
    });
}

function addProjectBoundaryToMap(project) {
    ["project-boundary", "project-tasks", "prediction-points"].forEach(
        (id) => {
            if (map.getSource(id)) {
                if (id === "project-tasks") {
                    map.removeLayer("project-tasks-fill");
                    map.removeLayer("project-tasks-line");
                } else {
                    map.removeLayer(id);
                }
                map.removeSource(id);
            }
        }
    );

    map.addSource("project-boundary", {
        type: "geojson",
        data: project.areaOfInterest,
    });
    map.addLayer({
        id: "project-boundary",
        type: "line",
        source: "project-boundary",
        paint: {
            "line-color": "#ef4444",
            "line-width": 3,
            "line-opacity": 0.8,
        },
    });

    map.addSource("project-tasks", {
        type: "geojson",
        data: project.tasks,
    });
    map.addLayer({
        id: "project-tasks-fill",
        type: "fill",
        source: "project-tasks",
        paint: {
            "fill-color": [
                "match",
                ["get", "taskStatus"],
                "VALIDATED",
                "#10b981",
                "MAPPED",
                "#3b82f6",
                "READY",
                "#f3f4f6",
                "INVALIDATED",
                "#ef4444",
                "#9ca3af",
            ],
            "fill-opacity": 0.6,
        },
    });
    map.addLayer({
        id: "project-tasks-line",
        type: "line",
        source: "project-tasks",
        paint: {
            "line-color": "#374151",
            "line-width": 1,
            "line-opacity": 0.5,
        },
    });

    const bbox = turf.bbox(project.areaOfInterest);
    map.fitBounds(bbox, { padding: 50 });
}

function getStatusColor(status) {
    const colors = {
        PUBLISHED: "bg-green-100 text-green-800",
        DRAFT: "bg-yellow-100 text-yellow-800",
        ARCHIVED: "bg-gray-100 text-gray-800",
    };
    return colors[status] || "bg-gray-100 text-gray-800";
}

function getPriorityColor(priority) {
    const colors = {
        HIGH: "bg-red-100 text-red-800",
        MEDIUM: "bg-yellow-100 text-yellow-800",
        LOW: "bg-green-100 text-green-800",
    };
    return colors[priority] || "bg-gray-100 text-gray-800";
}

function showAuthModal() {
    document.getElementById("authModal").classList.remove("hidden");
}
function closeAuthModal() {
    document.getElementById("authModal").classList.add("hidden");
}

async function authenticateUser() {
    const token = document.getElementById("tokenInput").value.trim();
    if (!token) {
        alert("Please enter your access token");
        return;
    }
    const button = document.getElementById("authButtonText"),
        spinner = document.getElementById("authSpinner");
    button.textContent = "Authenticating...";
    spinner.classList.remove("hidden");
    try {
        const response = await axios.get(`${FAIR_API_URL}/api/v1/auth/me/`, {
            headers: { 'access-token': `${token}` },
        });
        accessToken = token;
        userInfo = response.data;
        localStorage.setItem("fairAccessToken", token);
        displayUserInfo(userInfo);
        closeAuthModal();
        showPredictionModal();
    } catch (error) {
        alert("Invalid access token. Please check and try again.");
    } finally {
        button.textContent = "Authenticate";
        spinner.classList.add("hidden");
    }
}

function displayUserInfo(user) {
    document.getElementById("userInfo").classList.remove("hidden");
    document.getElementById("userName").textContent = user.username || "User";
    document.getElementById("userEmail").textContent = user.email || "";
    if (user.img_url)
        document.getElementById("userAvatar").src = user.img_url;
}

function showPredictionModal() {
    if (!accessToken) {
        showAuthModal();
        return;
    }
    if (!currentProject) {
        alert("Please select a project first");
        return;
    }
    document.getElementById(
        "predictionDescription"
    ).value = `Tasking Manager Project ${currentProject.projectId}`;
    document.getElementById(
        "predictionFolder"
    ).value = `TM/${currentProject.projectId}`;

    let sourceImagery = "";
    if (currentProject.imagery) {
        sourceImagery = currentProject.imagery;
    } else if (currentProject.projectInfo && currentProject.projectInfo.imagery) {
        sourceImagery = currentProject.projectInfo.imagery;
    } else {
        sourceImagery = getImageryTileUrl("Bing");
    }

    if (sourceImagery && sourceImagery.trim().toLowerCase() === "mapbox") {
        if (MAPBOX_ACCESS_TOKEN) {
            sourceImagery = `https://{s}.tiles.mapbox.com/v4/mapbox.satellite/{z}/{x}/{y}@2x.jpg?access_token=${MAPBOX_ACCESS_TOKEN}`;
        } else {
            console.warn("Mapbox source detected but MAPBOX_ACCESS_TOKEN not found in environment");
            sourceImagery = getImageryTileUrl("Bing");
        }
    }

    document.getElementById("sourceImagery").value = sourceImagery;
    document.getElementById("predictionModal").classList.remove("hidden");
}

function closePredictionModal() {
    document.getElementById("predictionModal").classList.add("hidden");
}

async function checkExistingPredictions() {
    if (!currentProject) {
        alert("Please select a project first");
        return;
    }
    try {
        const response = await axios.get(
            `${FAIR_API_URL}/api/workspace/prediction/TM/${currentProject.projectId}`
        );
        if (response.data && response.data.length > 0) {
            displayPredictionResults(response.data);
            loadPredictionResultsOnMap(currentProject.projectId);
        } else {
            alert("No existing predictions found for this project");
        }
    } catch (error) {
        alert("No existing predictions found for this project");
    }
}

function displayPredictionResults(files) {
    const container = document.getElementById("predictionFiles");
    container.innerHTML = "";
    files.forEach((file) => {
        const fileDiv = document.createElement("div");
        fileDiv.className = "text-sm text-green-600";
        fileDiv.textContent = file;
        container.appendChild(fileDiv);
    });
    document.getElementById("predictionResults").classList.remove("hidden");
}

async function loadPredictionResultsOnMap(projectId) {
    try {
        const response = await axios.get(
            `${FAIR_API_URL}/api/workspace/prediction/TM/${projectId}/labels_points.geojson`
        );
        if (map.getSource("prediction-points")) {
            map.removeLayer("prediction-points");
            map.removeSource("prediction-points");
        }
        map.addSource("prediction-points", {
            type: "geojson",
            data: response.data,
        });
        map.addLayer({
            id: "prediction-points",
            type: "circle",
            source: "prediction-points",
            paint: {
                "circle-radius": 4,
                "circle-color": "#f59e0b",
                "circle-stroke-color": "white",
                "circle-stroke-width": 1,
            },
        });
        addChoroplethLayer(response.data);
    } catch (error) {
        console.error("Error loading prediction results:", error);
    }
}

function addChoroplethLayer(predictionData) {
    if (!currentProject?.tasks) return;
    const taskCounts = {};
    let totalPredictions = 0;

    predictionData.features.forEach((prediction) => {
        currentProject.tasks.features.forEach((task) => {
            if (
                turf.booleanPointInPolygon(prediction.geometry, task.geometry)
            ) {
                const taskId = task.properties.taskId;
                taskCounts[taskId] = (taskCounts[taskId] || 0) + 1;
                totalPredictions++;
            }
        });
    });

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

    if (map.getSource("project-tasks")) {
        map.getSource("project-tasks").setData(tasksWithCounts);
        map.setPaintProperty("project-tasks-fill", "fill-color", [
            "interpolate",
            ["linear"],
            ["get", "predictionCount"],
            0,
            "#f3f4f6",
            1,
            "#fef3c7",
            5,
            "#fbbf24",
            10,
            "#f59e0b",
            20,
            "#d97706",
        ]);
    }

    const tasksWithPredictions = Object.keys(taskCounts).length;
    document.getElementById(
        "predictionStats"
    ).innerHTML = `Total: ${totalPredictions} predictions in ${tasksWithPredictions} tasks`;
}

document
    .getElementById("predictionForm")
    .addEventListener("submit", async (e) => {
        e.preventDefault();
        const formData = new FormData(e.target);

        const config = {
            source: document.getElementById("sourceImagery").value,
            checkpoint: document.getElementById("modelSelect").value,
            confidence: parseFloat(document.getElementById("confidence").value), // Already in percentage (0-100)
            tolerance: parseFloat(document.getElementById("tolerance").value),
            area_threshold: parseInt(document.getElementById("areaThreshold").value),
            orthogonalize: document.getElementById("orthogonalize").value === "true",
            ortho_max_angle_change_deg: parseInt(
                document.getElementById("maxAngleChange").value
            ),
            zoom_level: parseInt(document.getElementById("zoomLevel").value),
            ortho_skew_tolerance_deg: parseInt(
                document.getElementById("skewTolerance").value
            ),
        };

        let processedGeom = currentProject.areaOfInterest;
        console.log("Original Geometry:", processedGeom);
        console.log("Geometry Type:", processedGeom.type);
        if (processedGeom.type === "MultiPolygon") {
            console.log("Converting MultiPolygon to Polygon using union...");

            const polygons = processedGeom.coordinates.map(coords => ({
                type: "Feature",
                geometry: {
                    type: "Polygon",
                    coordinates: coords
                }
            }));

            let unionResult = polygons[0];
            for (let i = 1; i < polygons.length; i++) {
                unionResult = turf.union(unionResult, polygons[i]);
            }


            processedGeom = unionResult.geometry;
            console.log("Converted to Polygon:", processedGeom);
        } else if (processedGeom.type !== "Polygon") {
            console.error("Invalid geometry type:", processedGeom.type);
            alert("Invalid project geometry. Only Polygon and MultiPolygon are supported.");
            submitButton.textContent = "Generate Predictions";
            submitSpinner.classList.add("hidden");
            return;
        }

        const payload = {
            geom: processedGeom,
            config: config,
            description: document.getElementById("predictionDescription").value,
            folder: document.getElementById("predictionFolder").value,
        };

        console.log("API Payload:", JSON.stringify(payload, null, 2));

        const submitButton = document.getElementById("submitButtonText"),
            submitSpinner = document.getElementById("submitSpinner");
        submitButton.textContent = "Generating...";
        submitSpinner.classList.remove("hidden");

        try {
            const response = await axios.post(
                `${FAIR_API_URL}/api/v1/prediction/`,
                payload,
                { headers: { 'access-token': accessToken } }
            );
            closePredictionModal();
            monitorPredictionStatus(response.data.task_id);
        } catch (error) {
            alert("Error generating predictions: " + error.message);
        } finally {
            submitButton.textContent = "Generate Predictions";
            submitSpinner.classList.add("hidden");
        }
    });
function getImageryTileUrl(imagery) {
    const tileUrls = {
        Bing: "https://ecn.t{s}.tiles.virtualearth.net/tiles/a{q}.jpeg?g=1",
        Mapbox: MAPBOX_ACCESS_TOKEN
            ? `https://{s}.tiles.mapbox.com/v4/mapbox.satellite/{z}/{x}/{y}@2x.jpg?access_token=${MAPBOX_ACCESS_TOKEN}`
            : null,
        EsriWorldImagery:
            "https://services.arcgisonline.com/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}?blankTile=false",
        "Maxar-Standard":
            "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    };
    return tileUrls[imagery] || tileUrls["EsriWorldImagery"];
}

async function monitorPredictionStatus(taskId) {
    document.getElementById("statusModal").classList.remove("hidden");
    const checkStatus = async () => {
        try {
            const response = await axios.get(
                `${FAIR_API_URL}/api/v1/task/status/${taskId}`,
                { headers: { 'access-token': accessToken } }
            );
            const status = response.data.status;
            document.getElementById("statusText").textContent = `Status: ${status.charAt(0).toUpperCase() + status.slice(1)
                }`;
            const progress =
                status === "finished" ? 100 : status === "running" ? 50 : 10;
            document.getElementById("progressBar").style.width = `${progress}%`;
            if (status === "finished") {
                document.getElementById("statusText").textContent =
                    "Prediction completed!";
                setTimeout(() => {
                    closeStatusModal();
                    loadPredictionResultsOnMap(currentProject.projectId);
                }, 2000);
            } else if (status === "failed") {
                document.getElementById("statusText").textContent =
                    "Prediction failed";
            } else {
                setTimeout(checkStatus, 5000);
            }
        } catch (error) {
            console.error("Error checking status:", error);
            setTimeout(checkStatus, 5000);
        }
    };
    checkStatus();
}

function closeStatusModal() {
    document.getElementById("statusModal").classList.add("hidden");
}

function backToProjectsList() {
    document.getElementById("projectDetails").classList.add("hidden");
    document.getElementById("projectsList").classList.remove("hidden");
    [
        "project-boundary",
        "project-tasks-fill",
        "project-tasks-line",
        "prediction-points",
    ].forEach((layer) => {
        if (map.getLayer(layer)) map.removeLayer(layer);
    });
    ["project-boundary", "project-tasks", "prediction-points"].forEach(
        (source) => {
            if (map.getSource(source)) map.removeSource(source);
        }
    );
    currentProject = null;
}

if (accessToken) {
    axios
        .get(`${FAIR_API_URL}/api/v1/auth/me/`, {
            headers: { 'access-token': `${accessToken}` },
        })
        .then((response) => {
            userInfo = response.data;
            displayUserInfo(userInfo);
        })
        .catch(() => {
            localStorage.removeItem("fairAccessToken");
            accessToken = null;
        });
}

initMap();
