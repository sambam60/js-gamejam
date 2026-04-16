(function () {
  function compile(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const err = gl.getShaderInfoLog(shader) || 'shader compile failed';
      gl.deleteShader(shader);
      throw new Error(err);
    }
    return shader;
  }

  function link(gl, vsSource, fsSource) {
    const vs = compile(gl, gl.VERTEX_SHADER, vsSource);
    const fs = compile(gl, gl.FRAGMENT_SHADER, fsSource);
    const program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const err = gl.getProgramInfoLog(program) || 'program link failed';
      gl.deleteProgram(program);
      throw new Error(err);
    }
    return program;
  }

  class CRTPostProcess {
    constructor(sourceCanvas, outputCanvas) {
      this.sourceCanvas = sourceCanvas;
      this.outputCanvas = outputCanvas;
      this.enabled = true;
      this.supported = false;
      this.texW = 0;
      this.texH = 0;

      const gl = outputCanvas.getContext('webgl', {
        alpha: true,
        antialias: false,
        depth: false,
        stencil: false,
        premultipliedAlpha: false,
      });
      this.gl = gl;
      if (!gl) return;

      const vs = `
        attribute vec2 aPos;
        varying vec2 vUv;
        void main() {
          vUv = aPos * 0.5 + 0.5;
          gl_Position = vec4(aPos, 0.0, 1.0);
        }
      `;

      const fs = `
        precision mediump float;
        varying vec2 vUv;

        uniform sampler2D uTexture;
        uniform vec2 uResolution;
        uniform float uTime;
        uniform float uScanlineIntensity;
        uniform float uScanlineCount;
        uniform float uBrightness;
        uniform float uContrast;
        uniform float uSaturation;
        uniform float uBloomIntensity;
        uniform float uBloomThreshold;
        uniform float uRgbShift;
        uniform float uAdaptiveIntensity;
        uniform float uVignetteStrength;
        uniform float uCurvature;
        uniform float uFlickerStrength;

        const float PI = 3.14159265;
        const vec3 LUMA = vec3(0.299, 0.587, 0.114);

        vec2 curveRemapUV(vec2 uv) {
          vec2 c = uv * 2.0 - 1.0;
          float amount = uCurvature * 0.25;
          float dist = dot(c, c);
          c *= 1.0 + dist * amount;
          return c * 0.5 + 0.5;
        }

        float vignetteApprox(vec2 uv) {
          vec2 p = uv * 2.0 - 1.0;
          float d = max(abs(p.x), abs(p.y));
          return 1.0 - d * d * uVignetteStrength;
        }

        vec4 sampleBloom(vec2 uv, vec4 centerColor) {
          vec2 px = vec2(1.0) / max(uResolution, vec2(1.0));
          vec2 o = px * 3.0;
          vec4 c = centerColor * 0.4;
          vec4 cross =
              texture2D(uTexture, uv + vec2(o.x, 0.0)) +
              texture2D(uTexture, uv - vec2(o.x, 0.0)) +
              texture2D(uTexture, uv + vec2(0.0, o.y)) +
              texture2D(uTexture, uv - vec2(0.0, o.y));
          return c + cross * 0.15;
        }

        void main() {
          vec2 uv = vUv;
          if (uCurvature > 0.001) {
            uv = curveRemapUV(uv);
            if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
              gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
              return;
            }
          }

          vec4 pixel = texture2D(uTexture, uv);

          if (uBloomIntensity > 0.001) {
            float lum = dot(pixel.rgb, LUMA);
            float gate = uBloomThreshold * 0.5;
            if (lum > gate) {
              vec4 bloom = sampleBloom(uv, pixel);
              bloom.rgb *= uBrightness;
              float bloomLum = dot(bloom.rgb, LUMA);
              float bloomFactor = uBloomIntensity * max(0.0, (bloomLum - uBloomThreshold) * 1.5);
              pixel.rgb += bloom.rgb * bloomFactor;
            }
          }

          if (uRgbShift > 0.005) {
            float shift = uRgbShift * 0.005;
            pixel.r += texture2D(uTexture, vec2(uv.x + shift, uv.y)).r * 0.08;
            pixel.b += texture2D(uTexture, vec2(uv.x - shift, uv.y)).b * 0.08;
          }

          pixel.rgb *= uBrightness;
          float lum = dot(pixel.rgb, LUMA);
          pixel.rgb = (pixel.rgb - 0.5) * uContrast + 0.5;
          pixel.rgb = mix(vec3(lum), pixel.rgb, uSaturation);

          float mask = 1.0;
          if (uScanlineIntensity > 0.001) {
            float scanY = uv.y * uScanlineCount;
            float scan = abs(sin(scanY * PI));
            float adaptive = 1.0;
            if (uAdaptiveIntensity > 0.001) {
              float yPattern = sin(uv.y * 30.0) * 0.5 + 0.5;
              adaptive = 1.0 - yPattern * uAdaptiveIntensity * 0.2;
            }
            mask *= 1.0 - scan * uScanlineIntensity * adaptive;
          }

          if (uFlickerStrength > 0.001) {
            mask *= 1.0 + sin(uTime * 110.0) * uFlickerStrength;
          }
          if (uVignetteStrength > 0.001) {
            mask *= vignetteApprox(uv);
          }

          pixel.rgb *= mask;
          gl_FragColor = vec4(pixel.rgb, 1.0);
        }
      `;

      this.program = link(gl, vs, fs);
      this.locations = {
        aPos: gl.getAttribLocation(this.program, 'aPos'),
        uTexture: gl.getUniformLocation(this.program, 'uTexture'),
        uResolution: gl.getUniformLocation(this.program, 'uResolution'),
        uTime: gl.getUniformLocation(this.program, 'uTime'),
        uScanlineIntensity: gl.getUniformLocation(this.program, 'uScanlineIntensity'),
        uScanlineCount: gl.getUniformLocation(this.program, 'uScanlineCount'),
        uBrightness: gl.getUniformLocation(this.program, 'uBrightness'),
        uContrast: gl.getUniformLocation(this.program, 'uContrast'),
        uSaturation: gl.getUniformLocation(this.program, 'uSaturation'),
        uBloomIntensity: gl.getUniformLocation(this.program, 'uBloomIntensity'),
        uBloomThreshold: gl.getUniformLocation(this.program, 'uBloomThreshold'),
        uRgbShift: gl.getUniformLocation(this.program, 'uRgbShift'),
        uAdaptiveIntensity: gl.getUniformLocation(this.program, 'uAdaptiveIntensity'),
        uVignetteStrength: gl.getUniformLocation(this.program, 'uVignetteStrength'),
        uCurvature: gl.getUniformLocation(this.program, 'uCurvature'),
        uFlickerStrength: gl.getUniformLocation(this.program, 'uFlickerStrength'),
      };

      this.buffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
        -1, -1,
         1, -1,
        -1,  1,
         1,  1,
      ]), gl.STATIC_DRAW);

      this.texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.texture);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

      this.params = {
        scanlineIntensity: 0.5,
        scanlineCount: 320.0,
        brightness: 1.15,
        contrast: 1.05,
        saturation: 1.08,
        bloomIntensity: 0.35,
        bloomThreshold: 0.55,
        rgbShift: 0.45,
        adaptiveIntensity: 0.3,
        vignetteStrength: 0.32,
        curvature: 0.0,
        flickerStrength: 0.01,
      };

      this.supported = true;
    }

    resize(cssWidth, cssHeight, dpr) {
      if (!this.supported) return;
      const gl = this.gl;
      const pw = Math.max(1, Math.floor(cssWidth * dpr));
      const ph = Math.max(1, Math.floor(cssHeight * dpr));
      this.outputCanvas.width = pw;
      this.outputCanvas.height = ph;
      this.outputCanvas.style.width = cssWidth + 'px';
      this.outputCanvas.style.height = cssHeight + 'px';
      gl.viewport(0, 0, pw, ph);
    }

    setEnabled(enabled) {
      this.enabled = !!enabled;
    }

    render(timeSec) {
      if (!this.supported || !this.enabled) return;
      const gl = this.gl;

      if (this.sourceCanvas.width !== this.texW || this.sourceCanvas.height !== this.texH) {
        this.texW = this.sourceCanvas.width;
        this.texH = this.sourceCanvas.height;
        gl.bindTexture(gl.TEXTURE_2D, this.texture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, this.texW, this.texH, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      }

      gl.useProgram(this.program);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
      gl.enableVertexAttribArray(this.locations.aPos);
      gl.vertexAttribPointer(this.locations.aPos, 2, gl.FLOAT, false, 0, 0);

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.texture);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, this.sourceCanvas);

      gl.uniform1i(this.locations.uTexture, 0);
      gl.uniform2f(this.locations.uResolution, gl.drawingBufferWidth, gl.drawingBufferHeight);
      gl.uniform1f(this.locations.uTime, timeSec);
      gl.uniform1f(this.locations.uScanlineIntensity, this.params.scanlineIntensity);
      gl.uniform1f(this.locations.uScanlineCount, this.params.scanlineCount);
      gl.uniform1f(this.locations.uBrightness, this.params.brightness);
      gl.uniform1f(this.locations.uContrast, this.params.contrast);
      gl.uniform1f(this.locations.uSaturation, this.params.saturation);
      gl.uniform1f(this.locations.uBloomIntensity, this.params.bloomIntensity);
      gl.uniform1f(this.locations.uBloomThreshold, this.params.bloomThreshold);
      gl.uniform1f(this.locations.uRgbShift, this.params.rgbShift);
      gl.uniform1f(this.locations.uAdaptiveIntensity, this.params.adaptiveIntensity);
      gl.uniform1f(this.locations.uVignetteStrength, this.params.vignetteStrength);
      gl.uniform1f(this.locations.uCurvature, this.params.curvature);
      gl.uniform1f(this.locations.uFlickerStrength, this.params.flickerStrength);

      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
  }

  window.CRTPostProcess = CRTPostProcess;
})();
