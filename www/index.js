import { memory } from "wasm-map-generator/wasm_map_generator_bg";
import { NoiseMap } from "wasm-map-generator";
import { m4 } from "./m4";
import * as webglUtils from "./webgl-utils";
import * as dat from 'dat.gui';

const lerp = (x, y, a) => x * (1 - a) + y * a
const invlerp = (a, b, v) => clamp(( v - a ) / ( b - a ))
const clamp = (v, min = 0, max = 1) => Math.min(max, Math.max(min, v))
const CELL_SIZE = 1;

// Purely for constructing the GUI.
var NoiseMapJS = function() {
  this.width = 1000;
  this.height = 1000;
  this.scale = 323;
  this.octaves = 6;
  this.lacunarity = 2;
  this.persistence = 0.5;
  this.grayscale = false;
  this.reshape = false;
};

const gui = new dat.GUI({ autoPlace: false });
document.getElementById("controls").appendChild(gui.domElement);
const tmp = new NoiseMapJS();
const widthControl = gui.add(tmp, 'width').min(0);
const heightControl = gui.add(tmp, 'height').min(0);
const scaleControl = gui.add(tmp, 'scale').min(0).step(1);
const octavesControl = gui.add(tmp, 'octaves', 1, 10, 1);
const lacunarityControl = gui.add(tmp, 'lacunarity').min(0).step(0.1);
const persistenceControl = gui.add(tmp, 'persistence').min(0).step(0.01);
const grayscaleControl = gui.add(tmp, 'grayscale');
const reshapeControl = gui.add(tmp, 'reshape');

function createShader(gl, type, source) {
  var shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  var success = gl.getShaderParameter(shader, gl.COMPILE_STATUS);
  if (success) {
    return shader;
  }

  console.log(gl.getShaderInfoLog(shader));
  gl.deleteShader(shader);
}

function createProgram(gl, vertexShader, fragmentShader) {
  var program = gl.createProgram();
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  var success = gl.getProgramParameter(program, gl.LINK_STATUS);
  if (success) {
    return program;
  }

  console.log(gl.getProgramInfoLog(program));
  gl.deleteProgram(program);
}



const regenMap = () => {
  const map = NoiseMap.new(widthControl.getValue(),
    heightControl.getValue(),
    scaleControl.getValue(),
    octavesControl.getValue(),
    lacunarityControl.getValue(),
    persistenceControl.getValue(),
    reshapeControl.getValue(),
  );
  const width = map.width();
  const height = map.height();
  const maxNoiseVal = map.max_value();
  const minNoiseVal = map.min_value();
  const noise = new Float64Array(memory.buffer, map.noise_map(), width * height);

  const canvas = document.getElementById("c");
  canvas.width = width*CELL_SIZE;
  canvas.height = height*CELL_SIZE;
  const gl = canvas.getContext('webgl');
  if (!gl) {
    console.log("failed to init webgl");
    return;
  }

  // Get the strings for our GLSL shaders
  var vertexShaderSource = document.getElementById("v-shader").text;
  var fragmentShaderSource = document.getElementById("f-shader").text;

  // create GLSL shaders, upload the GLSL source, compile the shaders
  var vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexShaderSource);
  var fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, fragmentShaderSource);

  // Link the two shaders into a program
  var program = createProgram(gl, vertexShader, fragmentShader);

  gl.useProgram(program);

  var transformLocation = gl.getUniformLocation(program, "u_worldview");
  var aspect = gl.canvas.clientWidth / gl.canvas.clientHeight;
  var zNear = 1;
  var zFar = 2000;
  var transform = m4.perspective(1.0, aspect, zNear, zFar);
  transform = m4.translate(transform, -550, -50, -1450);
  transform = m4.xRotate(transform, -1.0);
  transform = m4.zRotate(transform, -1.2);

  var reverseLightDirectionLocation = gl.getUniformLocation(program, "u_reverseLightDirection");
  gl.uniform3fv(reverseLightDirectionLocation, m4.normalize([0.5, 0.7, 1]));

  var positionAttributeLocation = gl.getAttribLocation(program, "a_position");
  var positionBuffer = gl.createBuffer();

  var normalAttributeLocation = gl.getAttribLocation(program, "a_normal");
  var normalBuffer = gl.createBuffer();

  const vertices = map.vertices();

  gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW);

  const normals = map.normals();

  gl.bindBuffer(gl.ARRAY_BUFFER, normalBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(normals), gl.STATIC_DRAW);

  gl.enableVertexAttribArray(positionAttributeLocation);

  // Bind the position buffer.
  gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);

  // Tell the attribute how to get data out of positionBuffer (ARRAY_BUFFER)
  var size = 3;          // 3 components per iteration
  var type = gl.FLOAT;   // the data is 32bit floats
  var normalize = false; // don't normalize the data
  var stride = 0;        // 0 = move forward size * sizeof(type) each iteration to get the next position
  var offset = 0;        // start at the beginning of the buffer
  gl.vertexAttribPointer(
      positionAttributeLocation, size, type, normalize, stride, offset);

  gl.enableVertexAttribArray(normalAttributeLocation);

  // Bind the normal buffer.
  gl.bindBuffer(gl.ARRAY_BUFFER, normalBuffer);

  // Tell the attribute how to get data out of normalBuffer (ARRAY_BUFFER)
  var size = 3;          // 3 components per iteration
  var type = gl.FLOAT;   // the data is 32bit floats
  var normalize = false; // don't normalize the data
  var stride = 0;        // 0 = move forward size * sizeof(type) each iteration to get the next normal
  var offset = 0;        // start at the beginning of the buffer
  gl.vertexAttribPointer(
      normalAttributeLocation, size, type, normalize, stride, offset);

  const render = () => {
    webglUtils.resizeCanvasToDisplaySize(gl.canvas);

    // Tell WebGL how to convert from clip space to pixels
    gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);

    gl.enable(gl.CULL_FACE);
    gl.enable(gl.DEPTH_TEST);

    gl.uniformMatrix4fv(transformLocation, false, transform);

    // Clear the canvas
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    // draw
    var primitiveType = gl.TRIANGLES;
    var offset = 0;
    var count = 6 * (width - 1) * (height - 1);
    gl.drawArrays(primitiveType, offset, count);
  };

  render();

  document.addEventListener('keydown', (e) => {
    if(event.keyCode == 68) {
      transform = m4.translate(transform, 10, 0, 0);
    } else if(event.keyCode == 65) {
      transform = m4.translate(transform, -10, 0, 0);
    }

    if(event.keyCode == 83) {
      transform = m4.translate(transform, 0, -10, 0);
    } else if(event.keyCode == 87) {
      transform = m4.translate(transform, 0, 10, 0);
    }

    if (event.keyCode == 81) {
      transform = m4.translate(transform, 0, 0, 10);
    } else if (event.keyCode == 69) {
      transform = m4.translate(transform, 0, 0, -10);
    }

    if (event.keyCode == 73) {
      transform = m4.yRotate(transform, 0.1);
    } else if (event.keyCode == 75) {
      transform = m4.yRotate(transform, -0.1);
    }

    if (event.keyCode == 74) {
      transform = m4.xRotate(transform, -0.1);
    } else if (event.keyCode == 76) {
      transform = m4.xRotate(transform, 0.1);
    }

    if (event.keyCode == 85) {
      transform = m4.zRotate(transform, -0.1);
    } else if (event.keyCode == 79) {
      transform = m4.zRotate(transform, 0.1);
    }

    render();
  }, false);
}

regenMap();

widthControl.onFinishChange(regenMap);
heightControl.onFinishChange(regenMap);
scaleControl.onFinishChange(regenMap);
octavesControl.onFinishChange(regenMap);
lacunarityControl.onFinishChange(regenMap);
persistenceControl.onFinishChange(regenMap);
grayscaleControl.onFinishChange(regenMap);
reshapeControl.onFinishChange(regenMap);

colorControllers.forEach((controller, idx) => controller.onFinishChange(regenMap));
