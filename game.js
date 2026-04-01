import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';

// --- CONFIGURATION ---
const CELL_SIZE = 4;
const MAZE_SIZE = 21; // Must be odd
const WALL_HEIGHT = 4;

// --- GAME STATE ---
let scene, camera, renderer, controls;
let mazeData, player, monster;
let gameActive = false;
let moveForward = false;
let moveBackward = false;
let moveLeft = false;
let moveRight = false;
let monsterActive = false;
let monsterActivationTimer = Math.random() * 3 + 2; // 2-5 seconds random delay
let isSprinting = false;
let bobTimer = 0;
const velocity = new THREE.Vector3();
const direction = new THREE.Vector3();

// Monster chase system - speed is 1x faster than player walk speed
let monsterSpeed = 10.0; // Same as player walk speed (10.0)
let monsterLastKnownPosition = new THREE.Vector3();
let monsterHearingRadius = 25; // Increased range
let monsterScentRadius = 12; // New: always knows player position if this close
let monsterVisionCone = Math.PI / 3;

// Player health and stamina system
let playerHealth = 3; // 3 hearts
let maxStamina = 100;
let currentStamina = 100;
let staminaRegenRate = 15; // per second
let staminaDrainRate = 30; // per second when sprinting
let isInvulnerable = false;
let invulnerabilityTimer = 0;
let teleportCooldown = 0;

const walls = [];
const exits = [];
const bloodParticles = []; // To store animated blood systems

// --- MAZE GENERATION (Recursive Backtracker with Random Seed) ---
class Maze {
    constructor(size) {
        this.size = size;
        this.grid = Array(size).fill().map(() => Array(size).fill(1)); // 1 = wall, 0 = path
        this.shuffleAndGenerate(1, 1);
        this.placeExits();
    }

    shuffleAndGenerate(x, y) {
        this.grid[y][x] = 0;
        // Completely random direction order each time
        const dirs = [[0, 2], [0, -2], [2, 0], [-2, 0]];
        // Fisher-Yates shuffle for true randomness
        for (let i = dirs.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [dirs[i], dirs[j]] = [dirs[j], dirs[i]];
        }

        for (const [dx, dy] of dirs) {
            const nx = x + dx, ny = y + dy;
            if (nx > 0 && nx < this.size - 1 && ny > 0 && ny < this.size - 1 && this.grid[ny][nx] === 1) {
                this.grid[y + dy / 2][x + dx / 2] = 0;
                this.shuffleAndGenerate(nx, ny);
            }
        }
    }

    placeExits() {
        // Place exits at the END of corridors - like real doors in walls
        const potentialExits = [];
        
        // Find corridor ends (positions where there's a path with wall on one side)
        for (let y = 1; y < this.size - 1; y++) {
            for (let x = 1; x < this.size - 1; x++) {
                if (this.grid[y][x] === 0) {
                    // Check if this is a corridor end (dead end or T-junction)
                    const neighbors = [
                        this.grid[y-1][x], // up
                        this.grid[y+1][x], // down
                        this.grid[y][x-1], // left
                        this.grid[y][x+1]  // right
                    ];
                    const pathCount = neighbors.filter(n => n === 0).length;
                    
                    // If it's an end (only 1 neighbor) or has wall on edge
                    if (pathCount === 1 || 
                        y === 1 || y === this.size-2 || 
                        x === 1 || x === this.size-2) {
                        
                        // Determine which direction the door faces
                        let doorDir = null;
                        if (y === 1 && this.grid[y][x] === 0) doorDir = 'top';
                        else if (y === this.size-2 && this.grid[y][x] === 0) doorDir = 'bottom';
                        else if (x === 1 && this.grid[y][x] === 0) doorDir = 'left';
                        else if (x === this.size-2 && this.grid[y][x] === 0) doorDir = 'right';
                        
                        if (doorDir) {
                            potentialExits.push({
                                x: x,
                                y: y,
                                dir: doorDir
                            });
                        }
                    }
                }
            }
        }

        // Choose 3 random exits
        const chosen = potentialExits.sort(() => Math.random() - 0.5).slice(0, 3);
        chosen.forEach((pos, idx) => {
            exits.push({
                x: pos.x * CELL_SIZE,
                z: pos.y * CELL_SIZE,
                dir: pos.dir,
                isReal: idx === 0 // First one is real
            });
        });
    }
}

// --- MONSTER AI - Enhanced Chase System ---
class Monster {
    constructor() {
        // Scarier monster model - taller, thinner with glowing eyes
        const geometry = new THREE.Group();
        
        // Body
        const bodyGeo = new THREE.CylinderGeometry(0.3, 0.5, 2.5, 8);
        const bodyMat = new THREE.MeshPhongMaterial({ 
            color: 0x1a0000, 
            emissive: 0x330000,
            shininess: 100
        });
        const body = new THREE.Mesh(bodyGeo, bodyMat);
        geometry.add(body);
        
        // Head
        const headGeo = new THREE.SphereGeometry(0.6, 8, 8);
        const headMat = new THREE.MeshPhongMaterial({ 
            color: 0x0a0000,
            emissive: 0x220000
        });
        const head = new THREE.Mesh(headGeo, headMat);
        head.position.y = 1.5;
        geometry.add(head);
        
        // Glowing eyes
        const eyeGeo = new THREE.SphereGeometry(0.15, 8, 8);
        const eyeMat = new THREE.MeshBasicMaterial({ color: 0xff0000 });
        
        const leftEye = new THREE.Mesh(eyeGeo, eyeMat);
        leftEye.position.set(-0.25, 1.6, 0.4);
        geometry.add(leftEye);
        
        const rightEye = new THREE.Mesh(eyeGeo, eyeMat);
        rightEye.position.set(0.25, 1.6, 0.4);
        geometry.add(rightEye);
        
        // Arms
        const armGeo = new THREE.CylinderGeometry(0.1, 0.15, 1.5, 6);
        const armMat = new THREE.MeshPhongMaterial({ color: 0x1a0000 });
        
        const leftArm = new THREE.Mesh(armGeo, armMat);
        leftArm.position.set(-0.6, 0.5, 0.3);
        leftArm.rotation.z = Math.PI / 6;
        geometry.add(leftArm);
        
        const rightArm = new THREE.Mesh(armGeo, armMat);
        rightArm.position.set(0.6, 0.5, 0.3);
        rightArm.rotation.z = -Math.PI / 6;
        geometry.add(rightArm);
        
        this.mesh = geometry;
        
        // Spawn near player but not on top (give 3-6 cells distance)
        let spawnPos = new THREE.Vector3();
        let safeSpawn = false;
        let attempts = 0;
        
        while (!safeSpawn && attempts < 100) {
            const distance = (3 + Math.random() * 3) * CELL_SIZE;
            const angle = Math.random() * Math.PI * 2;
            const offsetX = Math.cos(angle) * distance;
            const offsetZ = Math.sin(angle) * distance;
            
            const targetX = camera.position.x + offsetX;
            const targetZ = camera.position.z + offsetZ;
            
            const gridX = Math.round(targetX / CELL_SIZE);
            const gridZ = Math.round(targetZ / CELL_SIZE);
            
            if (gridX > 0 && gridX < MAZE_SIZE - 1 && gridZ > 0 && gridZ < MAZE_SIZE - 1) {
                if (mazeData.grid[gridZ][gridX] === 0) {
                    spawnPos.set(targetX, 1.25, targetZ);
                    safeSpawn = true;
                }
            }
            attempts++;
        }
        
        if (!safeSpawn) {
            spawnPos.set((MAZE_SIZE - 2.5) * CELL_SIZE, 1.25, (MAZE_SIZE - 2.5) * CELL_SIZE);
        }
        
        this.mesh.position.copy(spawnPos);
        scene.add(this.mesh);
        
        // Add a red point light to the monster
        this.light = new THREE.PointLight(0xff0000, 8, 8);
        this.light.position.y = 1.5;
        this.mesh.add(this.light);
        
        // Add eerie fog around monster
        this.fogLight = new THREE.PointLight(0x550000, 5, 6);
        this.fogLight.position.y = 0.5;
        this.mesh.add(this.fogLight);
        
        this.chaseTimer = 0;
        this.patrolOffset = Math.random() * 100;
    }

    update(delta, playerPos) {
        if (!gameActive || !monsterActive) {
            if (gameActive && !monsterActive) {
                monsterActivationTimer -= delta;
                if (monsterActivationTimer <= 0) {
                    monsterActive = true;
                    // Create jump scare effect when monster activates
                    createMonsterSpawnEffect();
                }
            }
            return;
        }

        // Monster senses - can hear running or "smell" player if very close
        const distanceToPlayer = this.mesh.position.distanceTo(playerPos);
        const isPlayerRunning = isSprinting && distanceToPlayer < monsterHearingRadius;
        const isPlayerScented = distanceToPlayer < monsterScentRadius;
        
        // Check if monster can see player (line of sight)
        const canSeePlayer = this.hasLineOfSight(playerPos);
        
        let target;
        if (canSeePlayer || isPlayerRunning || isPlayerScented) {
            // Chase player directly
            target = playerPos.clone();
            target.y = this.mesh.position.y;
            this.chaseTimer += delta;
            
            // Speed increases as it chases longer
            const chaseSpeed = monsterSpeed * (1 + Math.min(this.chaseTimer * 0.1, 0.6));
            this.moveTowards(target, delta * chaseSpeed);
            
            // Update last known position for when it loses track
            monsterLastKnownPosition.copy(playerPos);
            
            // Pulse the HUD when monster is very close
            if (distanceToPlayer < 8) {
                const intensity = (8 - distanceToPlayer) / 8;
                document.body.style.boxShadow = `inset 0 0 ${50 + intensity * 150}px rgba(255, 0, 0, ${0.2 + intensity * 0.5})`;
            } else {
                document.body.style.boxShadow = 'none';
            }
        } else {
            // Patrol or move to last known
            document.body.style.boxShadow = 'none';
            if (this.mesh.position.distanceTo(monsterLastKnownPosition) > 1) {
                target = monsterLastKnownPosition.clone();
                target.y = this.mesh.position.y;
                this.moveTowards(target, delta * monsterSpeed);
            } else {
                this.patrol(delta);
            }
        }
        
        // Look at target
        if (target) {
            this.mesh.lookAt(target);
        }

        // Animation: breathing/walking effect
        const scale = 1 + Math.sin(Date.now() * 0.005) * 0.05;
        this.mesh.scale.set(scale, scale, scale);
        
        // Bobbing motion
        this.mesh.position.y = 1.25 + Math.sin(Date.now() * 0.003) * 0.1;

        // Check contact with player - DAMAGE instead of instant death
        if (distanceToPlayer < 1.2 && !isInvulnerable) {
            takeDamage();
        }
    }
    
    hasLineOfSight(targetPos) {
        // Simple raycast check (simplified for performance)
        const direction = targetPos.clone().sub(this.mesh.position).normalize();
        const distance = this.mesh.position.distanceTo(targetPos);
        
        // Check points along the line
        const steps = Math.floor(distance / 2);
        for (let i = 1; i < steps; i++) {
            const checkPos = this.mesh.position.clone().add(direction.clone().multiplyScalar(i * 2));
            if (checkWallCollision(checkPos.x, checkPos.z, 0.3)) {
                return false; // Wall blocks vision
            }
        }
        return true;
    }
    
    moveTowards(target, speed) {
        const moveDir = target.clone().sub(this.mesh.position).normalize();
        const nextPos = this.mesh.position.clone().add(moveDir.multiplyScalar(speed));
        
        if (!checkWallCollision(nextPos.x, nextPos.z, 0.5)) {
            this.mesh.position.copy(nextPos);
        } else {
            // Try sliding around walls
            const slideX = this.mesh.position.clone().add(new THREE.Vector3(moveDir.x, 0, 0).multiplyScalar(speed * 0.5));
            const slideZ = this.mesh.position.clone().add(new THREE.Vector3(0, 0, moveDir.z).multiplyScalar(speed * 0.5));
            
            if (!checkWallCollision(slideX.x, slideX.z, 0.5)) {
                this.mesh.position.copy(slideX);
            } else if (!checkWallCollision(slideZ.x, slideZ.z, 0.5)) {
                this.mesh.position.copy(slideZ);
            }
        }
    }
    
    patrol(delta) {
        // Slow patrol movement
        const time = Date.now() * 0.0005 + this.patrolOffset;
        const patrolX = Math.sin(time) * MAZE_SIZE * 0.3 * CELL_SIZE;
        const patrolZ = Math.cos(time * 0.7) * MAZE_SIZE * 0.3 * CELL_SIZE;
        const target = new THREE.Vector3(
            (MAZE_SIZE * CELL_SIZE) / 2 + patrolX,
            this.mesh.position.y,
            (MAZE_SIZE * CELL_SIZE) / 2 + patrolZ
        );
        this.moveTowards(target, delta * monsterSpeed * 0.5);
    }
}

// Spawn effect when monster appears
function createMonsterSpawnEffect() {
    // Flash red
    const flash = new THREE.PointLight(0xff0000, 50, 30);
    flash.position.copy(camera.position);
    scene.add(flash);
    
    // Screen shake effect
    const originalPos = camera.position.clone();
    let shakeCount = 0;
    const shake = () => {
        if (shakeCount < 10) {
            camera.position.x += (Math.random() - 0.5) * 0.5;
            camera.position.y += (Math.random() - 0.5) * 0.5;
            shakeCount++;
            setTimeout(shake, 30);
        } else {
            camera.position.y = 1.6; // Reset to height
        }
    };
    shake();
}

function createBloodDecals() {
    const particleCount = 20;
    
    // Create 30 blood clusters
    for (let i = 0; i < 30; i++) {
        const x = Math.random() * MAZE_SIZE * CELL_SIZE;
        const z = Math.random() * MAZE_SIZE * CELL_SIZE;
        
        if (!checkWallCollision(x, z, 0.1)) {
            const geometry = new THREE.BufferGeometry();
            const positions = new Float32Array(particleCount * 3);
            const velocities = [];
            
            for (let j = 0; j < particleCount; j++) {
                // Initial positions in a small cluster
                positions[j * 3] = (Math.random() - 0.5) * 1.2;
                positions[j * 3 + 1] = 0.05 + Math.random() * 0.1;
                positions[j * 3 + 2] = (Math.random() - 0.5) * 1.2;
                
                // Random velocities for floating effect
                velocities.push({
                    x: (Math.random() - 0.5) * 0.02,
                    y: (Math.random() - 0.5) * 0.01,
                    z: (Math.random() - 0.5) * 0.02
                });
            }
            
            geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
            
            const material = new THREE.PointsMaterial({
                color: 0x880000,
                size: 0.15,
                transparent: true,
                opacity: 0.8,
                blending: THREE.AdditiveBlending
            });
            
            const points = new THREE.Points(geometry, material);
            points.position.set(x, 0, z);
            scene.add(points);
            
            bloodParticles.push({
                mesh: points,
                velocities: velocities,
                initialY: 0.1
            });
        }
    }
}

function updateBloodParticles(delta) {
    bloodParticles.forEach(p => {
        const positions = p.mesh.geometry.attributes.position.array;
        
        for (let i = 0; i < positions.length / 3; i++) {
            // Update individual particle positions for a "swirling/floating" effect
            positions[i * 3] += p.velocities[i].x;
            positions[i * 3 + 1] += p.velocities[i].y;
            positions[i * 3 + 2] += p.velocities[i].z;
            
            // Constrain movement to the area
            if (Math.abs(positions[i * 3]) > 1) p.velocities[i].x *= -1;
            if (positions[i * 3 + 1] < 0.05 || positions[i * 3 + 1] > 0.4) p.velocities[i].y *= -1;
            if (Math.abs(positions[i * 3 + 2]) > 1) p.velocities[i].z *= -1;
        }
        
        p.mesh.geometry.attributes.position.needsUpdate = true;
        
        // Slight rotation to the whole cluster
        p.mesh.rotation.y += delta * 0.5;
    });
}

// Player damage and health system
function takeDamage() {
    if (isInvulnerable || playerHealth <= 0) return;
    
    playerHealth--;
    updateHealthDisplay();
    
    // Red flash overlay
    const damageOverlay = document.createElement('div');
    damageOverlay.className = 'damage-overlay';
    document.body.appendChild(damageOverlay);
    
    setTimeout(() => {
        document.body.removeChild(damageOverlay);
    }, 500);
    
    if (playerHealth <= 0) {
        gameOver("O monstro te pegou...");
    } else {
        // Teleport to random location
        teleportPlayer();
        
        // Grant invulnerability frames
        isInvulnerable = true;
        invulnerabilityTimer = 2.0; // 2 seconds of safety
    }
}

function teleportPlayer() {
    // Find a safe random position in the maze
    let safePosition = false;
    let attempts = 0;
    
    while (!safePosition && attempts < 50) {
        const randomX = Math.floor(Math.random() * (MAZE_SIZE - 2)) + 1;
        const randomZ = Math.floor(Math.random() * (MAZE_SIZE - 2)) + 1;
        
        // Check if this is a path (not wall)
        if (mazeData.grid[randomZ][randomX] === 0) {
            const newX = randomX * CELL_SIZE;
            const newZ = randomZ * CELL_SIZE;
            
            // Make sure it's not too close to monster
            const distFromMonster = Math.sqrt(
                Math.pow(newX - monster.mesh.position.x, 2) + 
                Math.pow(newZ - monster.mesh.position.z, 2)
            );
            
            if (distFromMonster > 10) {
                camera.position.set(newX, 1.6, newZ);
                safePosition = true;
                
                // Teleport effect
                const teleportLight = new THREE.PointLight(0x00ffff, 30, 15);
                teleportLight.position.copy(camera.position);
                scene.add(teleportLight);
                setTimeout(() => {
                    scene.remove(teleportLight);
                }, 300);
            }
        }
        attempts++;
    }
}

function updateHealthDisplay() {
    const hearts = document.querySelectorAll('.heart');
    hearts.forEach((heart, index) => {
        if (index < playerHealth) {
            heart.classList.remove('lost');
        } else {
            heart.classList.add('lost');
        }
    });
}

function updateStamina(delta) {
    // Only drain stamina if sprinting AND moving
    const isMoving = moveForward || moveBackward || moveLeft || moveRight;
    
    if (isSprinting && isMoving && currentStamina > 0) {
        currentStamina -= staminaDrainRate * delta;
        if (currentStamina < 0) currentStamina = 0;
    } else if (currentStamina < maxStamina) {
        // Regenerate when not sprinting or standing still
        currentStamina += staminaRegenRate * delta;
        if (currentStamina > maxStamina) currentStamina = maxStamina;
    }
    
    // Update stamina bar
    const staminaFill = document.getElementById('stamina-fill');
    const staminaPercent = (currentStamina / maxStamina) * 100;
    staminaFill.style.width = staminaPercent + '%';
    
    // Change color based on stamina level
    if (staminaPercent > 50) {
        staminaFill.style.background = 'linear-gradient(90deg, #00ff00, #00ff88)';
    } else if (staminaPercent > 25) {
        staminaFill.style.background = 'linear-gradient(90deg, #ffff00, #88ff00)';
    } else {
        staminaFill.style.background = 'linear-gradient(90deg, #ff0000, #ff8800)';
    }
}

function resetGame() {
    playerHealth = 3;
    currentStamina = 100;
    updateHealthDisplay();
    updateStamina(0);
}

// --- INITIALIZATION ---
function init() {
    try {
        scene = new THREE.Scene();
        scene.background = new THREE.Color(0x000000);
        scene.fog = new THREE.FogExp2(0x000000, 0.15);

        camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
        
        // Random spawn position at maze entrance
        const startX = CELL_SIZE + (Math.random() - 0.5) * 2;
        const startZ = CELL_SIZE + (Math.random() - 0.5) * 2;
        camera.position.set(startX, 1.6, startZ);

        renderer = new THREE.WebGLRenderer({ antialias: true });
        renderer.setSize(window.innerWidth, window.innerHeight);
        renderer.setPixelRatio(window.devicePixelRatio);
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        document.body.appendChild(renderer.domElement);

        // Very dark ambient light - almost pitch black
        const ambientLight = new THREE.AmbientLight(0x050000, 0.15);
        scene.add(ambientLight);

        // Player's flashlight - brighter and more focused
        const flashLight = new THREE.SpotLight(0xffffff, 25);
        flashLight.angle = Math.PI / 6;
        flashLight.penumbra = 0.5;
        flashLight.decay = 2;
        flashLight.distance = 30;
        flashLight.castShadow = true;
        flashLight.shadow.mapSize.width = 2048;
        flashLight.shadow.mapSize.height = 2048;
        flashLight.shadow.camera.near = 0.5;
        flashLight.shadow.camera.far = 50;
        flashLight.shadow.bias = -0.0001;
        camera.add(flashLight);
        flashLight.position.set(0, 0, 0);
        flashLight.target.position.set(0, 0, -1);
        camera.add(flashLight.target);
        scene.add(camera);

        // Add subtle rim light for atmosphere
        const rimLight = new THREE.DirectionalLight(0x1a0000, 0.3);
        rimLight.position.set(10, 10, 5);
        scene.add(rimLight);

        controls = new PointerLockControls(camera, document.body);

        // Generate new random maze each game
        mazeData = new Maze(MAZE_SIZE);
        createMazeMesh(mazeData);

        monster = new Monster();
        createBloodDecals();

        setupUI();
        setupControls();

        console.log("Game initialized successfully!");
        
        animate();
    } catch (error) {
        console.error("Error initializing game:", error);
        alert("Erro ao iniciar o jogo: " + error.message);
    }
}

function createMazeMesh(mazeData) {
    // Blood-red walls with better material
    const wallGeo = new THREE.BoxGeometry(CELL_SIZE, WALL_HEIGHT, CELL_SIZE);
    const wallMat = new THREE.MeshPhongMaterial({ 
        color: 0x3d1a1a,
        emissive: 0x1a0505,
        shininess: 30,
        specular: 0x220000
    });

    // Dark blood-stained floor
    const floorGeo = new THREE.PlaneGeometry(MAZE_SIZE * CELL_SIZE, MAZE_SIZE * CELL_SIZE);
    const floorMat = new THREE.MeshPhongMaterial({ 
        color: 0x0f0505,
        emissive: 0x050000,
        shininess: 8,
        specular: 0x110000
    });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set((MAZE_SIZE * CELL_SIZE) / 2 - CELL_SIZE / 2, 0, (MAZE_SIZE * CELL_SIZE) / 2 - CELL_SIZE / 2);
    floor.receiveShadow = true;
    scene.add(floor);

    // Pitch black ceiling
    const ceilingGeo = new THREE.PlaneGeometry(MAZE_SIZE * CELL_SIZE, MAZE_SIZE * CELL_SIZE);
    const ceilingMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
    const ceiling = new THREE.Mesh(ceilingGeo, ceilingMat);
    ceiling.rotation.x = Math.PI / 2;
    ceiling.position.set((MAZE_SIZE * CELL_SIZE) / 2 - CELL_SIZE / 2, WALL_HEIGHT, (MAZE_SIZE * CELL_SIZE) / 2 - CELL_SIZE / 2);
    scene.add(ceiling);

    for (let y = 0; y < MAZE_SIZE; y++) {
        for (let x = 0; x < MAZE_SIZE; x++) {
            if (mazeData.grid[y][x] === 1) {
                const wall = new THREE.Mesh(wallGeo, wallMat);
                wall.position.set(x * CELL_SIZE, WALL_HEIGHT / 2, y * CELL_SIZE);
                wall.castShadow = true;
                wall.receiveShadow = true;
                scene.add(wall);
                walls.push(wall);
            }
        }
    }

    // Visual markers for exits - REAL DOORS in walls (not floating lights)
    exits.forEach(exit => {
        // Create door frame structure
        const doorWidth = CELL_SIZE * 0.9;
        const doorHeight = WALL_HEIGHT * 0.9;
        const doorDepth = 0.3;
        
        // Door position based on direction
        let doorX = exit.x;
        let doorZ = exit.z;
        let doorRotation = 0;
        
        if (exit.dir === 'top') {
            doorZ -= CELL_SIZE / 2;
            doorRotation = 0;
        } else if (exit.dir === 'bottom') {
            doorZ += CELL_SIZE / 2;
            doorRotation = Math.PI;
        } else if (exit.dir === 'left') {
            doorX -= CELL_SIZE / 2;
            doorRotation = -Math.PI / 2;
        } else if (exit.dir === 'right') {
            doorX += CELL_SIZE / 2;
            doorRotation = Math.PI / 2;
        }
        
        // Door frame (wood/dark metal)
        const frameGeo = new THREE.BoxGeometry(doorWidth, doorHeight, doorDepth);
        const frameMat = new THREE.MeshPhongMaterial({ 
            color: exit.isReal ? 0x004400 : 0x660000,
            emissive: exit.isReal ? 0x002200 : 0x330000,
            shininess: 50
        });
        const doorFrame = new THREE.Mesh(frameGeo, frameMat);
        doorFrame.position.set(doorX, doorHeight / 2, doorZ);
        doorFrame.rotation.y = doorRotation;
        scene.add(doorFrame);
        
        // Glowing portal inside the door frame (not blocking)
        const portalGeo = new THREE.PlaneGeometry(doorWidth * 0.8, doorHeight * 0.8);
        const portalMat = new THREE.MeshBasicMaterial({ 
            color: exit.isReal ? 0x00ff00 : 0xff0000,
            transparent: true,
            opacity: 0.7,
            side: THREE.DoubleSide
        });
        const portal = new THREE.Mesh(portalGeo, portalMat);
        portal.position.set(doorX, doorHeight / 2, doorZ);
        portal.rotation.y = doorRotation;
        scene.add(portal);
        
        // Strong glow effect from the doorway
        const exitLight = new THREE.PointLight(
            exit.isReal ? 0x00ff00 : 0xff0000, 
            10,  // Very bright
            12   // Large radius
        );
        exitLight.position.set(doorX, doorHeight / 2, doorZ);
        scene.add(exitLight);
        
        // Add particles for fake exits (danger warning)
        if (!exit.isReal) {
            const particleGeo = new THREE.BufferGeometry();
            const particleCount = 30;
            const positions = new Float32Array(particleCount * 3);
            
            for (let i = 0; i < particleCount; i++) {
                positions[i * 3] = doorX + (Math.random() - 0.5) * doorWidth;
                positions[i * 3 + 1] = Math.random() * doorHeight;
                positions[i * 3 + 2] = doorZ + (Math.random() - 0.5) * 2;
            }
            
            particleGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
            const particleMat = new THREE.PointsMaterial({ 
                color: 0xff0000, 
                size: 0.4,
                transparent: true,
                opacity: 0.7
            });
            const particles = new THREE.Points(particleGeo, particleMat);
            scene.add(particles);
        }
    });
}

function checkWallCollision(x, z, radius = 0.5) {
    const gridX = Math.round(x / CELL_SIZE);
    const gridZ = Math.round(z / CELL_SIZE);

    for (let i = -1; i <= 1; i++) {
        for (let j = -1; j <= 1; j++) {
            const nx = gridX + i;
            const nz = gridZ + j;
            if (nx >= 0 && nx < MAZE_SIZE && nz >= 0 && nz < MAZE_SIZE) {
                if (mazeData.grid[nz][nx] === 1) {
                    const wallX = nx * CELL_SIZE;
                    const wallZ = nz * CELL_SIZE;
                    const dx = Math.abs(x - wallX);
                    const dz = Math.abs(z - wallZ);
                    if (dx < (CELL_SIZE / 2 + radius) && dz < (CELL_SIZE / 2 + radius)) {
                        return true;
                    }
                }
            } else if (nx < 0 || nx >= MAZE_SIZE || nz < 0 || nz >= MAZE_SIZE) {
                // Out of bounds is also "wall"
                return true;
            }
        }
    }
    return false;
}

function checkExitCollection() {
    let nearRealExit = false;
    
    exits.forEach(exit => {
        // Calculate door position (same logic as in createMazeMesh)
        let doorX = exit.x;
        let doorZ = exit.z;
        
        if (exit.dir === 'top') {
            doorZ -= CELL_SIZE / 2;
        } else if (exit.dir === 'bottom') {
            doorZ += CELL_SIZE / 2;
        } else if (exit.dir === 'left') {
            doorX -= CELL_SIZE / 2;
        } else if (exit.dir === 'right') {
            doorX += CELL_SIZE / 2;
        }
        
        const dist = Math.sqrt(
            Math.pow(camera.position.x - doorX, 2) + 
            Math.pow(camera.position.z - doorZ, 2)
        );
        
        // DIRECT CONTACT required - very small radius (0.8 units)
        if (dist < 0.8) {
            if (exit.isReal) {
                // Create victory effect - green flash
                const victoryLight = new THREE.PointLight(0x00ff00, 50, 30);
                victoryLight.position.copy(camera.position);
                scene.add(victoryLight);
                
                setTimeout(() => {
                    scene.remove(victoryLight);
                    victory();
                }, 200);
            } else {
                gameOver("Saída errada! Você foi pego por uma armadilha.");
            }
        }
        
        // Show hint when near real exit
        if (exit.isReal && dist < 10.0) {
            nearRealExit = true;
            const hintElement = document.getElementById('exit-hint');
            const intensity = Math.max(0.3, 1 - dist / 10);
            hintElement.style.opacity = intensity;
            hintElement.innerText = dist < 5 ? "🟢 SAÍDA VERDADEIRA!" : "💚 Algo está chamando...";
            hintElement.classList.remove('hidden');
        }
    });
    
    // Hide hint if not near any real exit
    if (!nearRealExit) {
        const hintElement = document.getElementById('exit-hint');
        hintElement.classList.add('hidden');
    }
}

// --- LOOP ---
let prevTime = performance.now();
let flickerTimer = 0;
let flickerIntensity = 1.0;
function animate() {
    requestAnimationFrame(animate);

    const time = performance.now();
    const delta = (time - prevTime) / 1000;

    if (gameActive && controls.isLocked) {
        const walkSpeed = 10.0;
        const sprintSpeed = 18.0;
        const speed = isSprinting && currentStamina > 0 ? sprintSpeed : walkSpeed;

        // Update invulnerability timer
        if (isInvulnerable) {
            invulnerabilityTimer -= delta;
            if (invulnerabilityTimer <= 0) {
                isInvulnerable = false;
            }
        }
        
        // Update stamina
        updateStamina(delta);
        
        // Prevent sprint if no stamina
        if (currentStamina <= 0) {
            isSprinting = false;
        }

        // Get camera direction
        const forwardDir = new THREE.Vector3();
        const rightDir = new THREE.Vector3();
        
        // Get where camera is looking (horizontal only)
        forwardDir.set(0, 0, -1).applyQuaternion(camera.quaternion);
        forwardDir.y = 0;
        forwardDir.normalize();
        
        rightDir.crossVectors(forwardDir, new THREE.Vector3(0, 1, 0)).normalize();
        
        // Build movement direction
        const moveDirection = new THREE.Vector3(0, 0, 0);
        
        if (moveForward) moveDirection.add(forwardDir);
        if (moveBackward) moveDirection.sub(forwardDir);
        if (moveRight) moveDirection.add(rightDir);
        if (moveLeft) moveDirection.sub(rightDir);
        
        // Move player
        if (moveDirection.length() > 0) {
            moveDirection.normalize();
            
            const moveAmount = speed * delta;
            const oldPos = camera.position.clone();
            
            // Apply movement
            camera.position.add(moveDirection.multiplyScalar(moveAmount));
            
            // Check collision
            if (checkWallCollision(camera.position.x, camera.position.z)) {
                camera.position.copy(oldPos);
            }
        }

        // Head Bobbing & Flashlight Effects
        const isMoving = moveForward || moveBackward || moveLeft || moveRight;
        const light = camera.children.find(c => c.type === 'SpotLight');

        if (isMoving) {
            bobTimer += delta * (isSprinting ? 15 : 8);
            const bobAmount = isSprinting ? 0.15 : 0.07;
            camera.position.y = THREE.MathUtils.lerp(camera.position.y, 1.6 + Math.sin(bobTimer) * bobAmount, 0.3);
            
            if (light) {
                light.position.x = Math.cos(bobTimer * 0.5) * 0.1;
                light.position.y = Math.sin(bobTimer * 0.5) * 0.1;
            }
        } else {
            camera.position.y = THREE.MathUtils.lerp(camera.position.y, 1.6, 0.1);
        }

        // Randomly flickering flashlight for atmosphere
        if (light) {
            flickerTimer += delta;
            if (flickerTimer > 0.1) {
                flickerTimer = 0;
                if (Math.random() > 0.98) {
                    flickerIntensity = 0.2 + Math.random() * 0.4;
                } else {
                    flickerIntensity = THREE.MathUtils.lerp(flickerIntensity, 1.0, 0.2);
                }
                light.intensity = 25 * flickerIntensity;
            }
        }

        monster.update(delta, camera.position);
        updateBloodParticles(delta);
        checkExitCollection();
    }

    renderer.render(scene, camera);
    prevTime = time;
}

// --- UI & EVENTS ---
function setupUI() {
    const startBtn = document.getElementById('start-button');
    const restartBtns = document.querySelectorAll('.restart-button');

    startBtn.onclick = () => {
        controls.lock();
    };

    restartBtns.forEach(btn => {
        btn.onclick = () => {
            window.location.reload();
        };
    });

    controls.addEventListener('lock', () => {
        document.getElementById('start-screen').classList.add('hidden');
        document.getElementById('hud').classList.remove('hidden');
        gameActive = true;
    });

    controls.addEventListener('unlock', () => {
        if (gameActive) {
            // Pause logic could go here
        }
    });
}

function setupControls() {
    const onKeyDown = (event) => {
        switch (event.code) {
            case 'ArrowUp':
            case 'KeyW': moveForward = true; break;
            case 'ArrowLeft':
            case 'KeyA': moveLeft = true; break;
            case 'ArrowDown':
            case 'KeyS': moveBackward = true; break;
            case 'ArrowRight':
            case 'KeyD': moveRight = true; break;
            case 'ShiftLeft':
            case 'ShiftRight': isSprinting = true; break;
        }
    };

    const onKeyUp = (event) => {
        switch (event.code) {
            case 'ArrowUp':
            case 'KeyW': moveForward = false; break;
            case 'ArrowLeft':
            case 'KeyA': moveLeft = false; break;
            case 'ArrowDown':
            case 'KeyS': moveBackward = false; break;
            case 'ArrowRight':
            case 'KeyD': moveRight = false; break;
            case 'ShiftLeft':
            case 'ShiftRight': isSprinting = false; break;
        }
    };

    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onKeyUp);
}

function gameOver(reason) {
    gameActive = false;
    controls.unlock();
    
    // Add blood splatter effect
    document.getElementById('death-reason').innerText = reason;
    document.getElementById('game-over-screen').classList.remove('hidden');
    document.getElementById('hud').classList.add('hidden');
    
    // Red flash effect
    const overlay = document.getElementById('game-over-screen');
    overlay.style.background = 'radial-gradient(circle at center, rgba(255,0,0,0.8) 0%, rgba(0,0,0,0.95) 100%)';
    setTimeout(() => {
        overlay.style.background = 'radial-gradient(circle at center, rgba(40, 0, 0, 0.7) 0%, rgba(0, 0, 0, 0.95) 100%)';
    }, 300);
}

function victory() {
    gameActive = false;
    controls.unlock();
    document.getElementById('victory-screen').classList.remove('hidden');
    document.getElementById('hud').classList.add('hidden');
}

// Restart buttons should reset health and stamina
document.querySelectorAll('.restart-button').forEach(btn => {
    btn.onclick = () => {
        resetGame();
        window.location.reload();
    };
});

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

init();
