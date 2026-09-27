// The procedural and gradient skies, drawn by a shader into a cube map. The same cube map is the background and
// lights the scene (three.js turns it into a PMREM when it is scene.environment), so the sun in the sky, the sun
// light and the reflections always agree. Nothing is saved but the parameters.

const VERTEX_SHADER = `
varying vec3 vDirection;
void main () {
    vDirection = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

// Colors are linear and can go above 1 (the sun), so that the lighting made from the sky is bright enough.
const FRAGMENT_SHADER = `
uniform int uMode;
uniform vec3 uTop;
uniform vec3 uBottom;
uniform vec3 uSunDirection;
uniform vec3 uSunColor;
uniform float uClouds;
varying vec3 vDirection;

float hash (vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
}

float noise (vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(
        mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
        mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
        u.y
    );
}

float fbm (vec2 p) {
    float value = 0.0;
    float amplitude = 0.5;
    mat2 turn = mat2(0.8, 0.6, -0.6, 0.8);
    for (int i = 0; i < 6; i++) {
        value += amplitude * noise(p);
        p = turn * p * 2.03 + vec2(17.1, 9.2);
        amplitude *= 0.5;
    }
    return value;
}

void main () {
    vec3 direction = normalize(vDirection);
    if (uMode == 0) {
        gl_FragColor = vec4(mix(uBottom, uTop, smoothstep(-0.3, 0.8, direction.y)), 1.0);
        return;
    }

    vec3 sunDirection = normalize(uSunDirection);
    float day = smoothstep(-0.12, 0.3, sunDirection.y);
    float sunset = 1.0 - smoothstep(0.0, 0.4, abs(sunDirection.y));
    float towardsSun = max(dot(direction, sunDirection), 0.0);

    vec3 zenith = mix(vec3(0.004, 0.006, 0.02), vec3(0.07, 0.22, 0.6), day);
    vec3 horizon = mix(vec3(0.02, 0.025, 0.05), vec3(0.5, 0.66, 0.86), day);
    horizon = mix(horizon, vec3(1.0, 0.42, 0.16) * (0.3 + day), sunset * (0.25 + 0.75 * pow(towardsSun, 3.0)));
    vec3 color = mix(horizon, zenith, pow(max(direction.y, 0.0), 0.45));
    vec3 ground = mix(horizon * 0.4, vec3(0.3, 0.28, 0.25), 0.5) * (0.15 + 0.85 * day);
    color = mix(ground, color, smoothstep(-0.08, 0.0, direction.y));

    float disc = smoothstep(0.99965, 0.99985, towardsSun);
    vec3 glow = uSunColor * (pow(towardsSun, 400.0) * 3.0 + pow(towardsSun, 24.0) * 0.35 * (0.3 + day));

    if (uClouds > 0.0 && direction.y > 0.0) {
        vec2 uv = direction.xz / (direction.y + 0.12) * 1.4;
        float n = fbm(uv);
        float threshold = mix(0.82, 0.18, uClouds);
        float cover = smoothstep(threshold, threshold + 0.22, n) * smoothstep(0.0, 0.18, direction.y);
        vec3 lit = mix(vec3(1.0), vec3(0.6, 0.63, 0.7), smoothstep(threshold + 0.1, threshold + 0.55, n));
        lit *= (0.08 + 1.0 * day) * mix(vec3(1.0), vec3(1.0, 0.62, 0.42), sunset * 0.7);
        lit += uSunColor * pow(towardsSun, 10.0) * 0.6 * day;
        color = mix(color, lit, cover);
        disc *= 1.0 - cover;
        glow *= 1.0 - cover * 0.8;
    }

    color += glow + uSunColor * disc * 40.0 * (0.2 + day);
    gl_FragColor = vec4(color, 1.0);
}
`;

// Pixels per face of the cube map
const SIZE = 512;

class SkyRenderer {
    /**
     * @param {object} THREE three.js
     * @param {boolean} hdr true if the renderer can render to half float targets
     */
    constructor (THREE, hdr) {
        this.THREE = THREE;
        this.material = new THREE.ShaderMaterial({
            vertexShader: VERTEX_SHADER,
            fragmentShader: FRAGMENT_SHADER,
            side: THREE.BackSide,
            depthWrite: false,
            depthTest: false,
            uniforms: {
                uMode: {value: 1},
                uTop: {value: new THREE.Color()},
                uBottom: {value: new THREE.Color()},
                uSunDirection: {value: new THREE.Vector3(0, 1, 0)},
                uSunColor: {value: new THREE.Color(1, 1, 1)},
                uClouds: {value: 0}
            }
        });
        this.scene = new THREE.Scene();
        this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 32), this.material);
        this.scene.add(this.mesh);
        this.target = new THREE.WebGLCubeRenderTarget(SIZE, {
            type: hdr ? THREE.HalfFloatType : THREE.UnsignedByteType,
            generateMipmaps: true,
            minFilter: THREE.LinearMipmapLinearFilter
        });
        this.camera = new THREE.CubeCamera(0.1, 10, this.target);
    }

    /**
     * @returns {THREE.CubeTexture} the sky, updated by render()
     */
    get texture () {
        return this.target.texture;
    }

    /**
     * Draw the sky into the cube map.
     * @param {THREE.WebGLRenderer} renderer
     * @param {object} params
     * @param {string} params.type 'procedural' or 'gradient'
     * @param {THREE.Color} params.top gradient top, linear
     * @param {THREE.Color} params.bottom gradient bottom, linear
     * @param {THREE.Vector3} params.sunDirection where the sun light comes from
     * @param {THREE.Color} params.sunColor linear
     * @param {number} params.clouds 0 to 1
     */
    render (renderer, params) {
        const uniforms = this.material.uniforms;
        uniforms.uMode.value = params.type === 'gradient' ? 0 : 1;
        uniforms.uTop.value.copy(params.top);
        uniforms.uBottom.value.copy(params.bottom);
        uniforms.uSunDirection.value.copy(params.sunDirection).normalize();
        uniforms.uSunColor.value.copy(params.sunColor);
        uniforms.uClouds.value = params.clouds;
        const autoClear = renderer.autoClear;
        renderer.autoClear = true;
        this.camera.update(renderer, this.scene);
        renderer.autoClear = autoClear;
        // three.js keeps a PMREM of it for lighting and blurred backgrounds; make it redo that
        this.target.texture.needsPMREMUpdate = true;
    }

    dispose () {
        this.mesh.geometry.dispose();
        this.material.dispose();
        this.target.dispose();
    }
}

module.exports = SkyRenderer;
