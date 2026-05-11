const CHARS = Array.from(" .:coPO?@■");
const CHAR_PIXEL_SIZE = 8;

const imageInput = document.querySelector("#imageInput");
const resolutionPreset = document.querySelector("#resolutionPreset");
const customSize = document.querySelector("#customSize");
const customWidth = document.querySelector("#customWidth");
const customHeight = document.querySelector("#customHeight");
const edgeTolerance = document.querySelector("#edgeTolerance");
const edgeToleranceNumber = document.querySelector("#edgeToleranceNumber");
const renderButton = document.querySelector("#renderButton");
const copyButton = document.querySelector("#copyButton");
const downloadButton = document.querySelector("#downloadButton");
const statusText = document.querySelector("#status");
const inputCanvas = document.querySelector("#inputCanvas");
const outputCanvas = document.querySelector("#outputCanvas");
const asciiOutput = document.querySelector("#asciiOutput");
const textMeta = document.querySelector("#textMeta");

let loadedImage = null;
let loadedFileName = "ascii-render";
let latestAscii = "";

imageInput.addEventListener("change", async () => {
  const file = imageInput.files?.[0];
  if (!file) {
    return;
  }

  loadedFileName = file.name.replace(/\.[^.]+$/, "") || "ascii-render";
  loadedImage = await createImageBitmap(file);
  renderButton.disabled = false;
  drawInputPreview(loadedImage);
  setStatus(`Loaded ${file.name} (${loadedImage.width}x${loadedImage.height}).`);
});

resolutionPreset.addEventListener("change", () => {
  customSize.hidden = resolutionPreset.value !== "custom";
});

edgeTolerance.addEventListener("input", () => {
  edgeToleranceNumber.value = edgeTolerance.value;
});

edgeToleranceNumber.addEventListener("input", () => {
  const value = clamp(Number(edgeToleranceNumber.value), 0, 100);
  edgeTolerance.value = value;
  edgeToleranceNumber.value = value;
});

renderButton.addEventListener("click", () => {
  if (!loadedImage) {
    return;
  }

  setStatus("Rendering...");
  requestAnimationFrame(() => {
    const target = getTargetSize(loadedImage);
    const imageData = drawScaledImage(loadedImage, target.width, target.height);
    const render = renderAscii(imageData, Number(edgeTolerance.value));

    latestAscii = render.text;
    asciiOutput.textContent = latestAscii;
    textMeta.textContent = `${render.columns} columns x ${render.rows} rows`;
    drawAsciiCanvas(render);

    copyButton.disabled = false;
    downloadButton.disabled = false;
    setStatus(`Rendered ${target.width}x${target.height} image as ASCII.`);
  });
});

copyButton.addEventListener("click", async () => {
  if (!latestAscii) {
    return;
  }

  await navigator.clipboard.writeText(latestAscii);
  setStatus("ASCII text copied to clipboard.");
});

downloadButton.addEventListener("click", () => {
  if (!latestAscii) {
    return;
  }

  const link = document.createElement("a");
  link.download = `${loadedFileName}_ascii.png`;
  link.href = outputCanvas.toDataURL("image/png");
  link.click();
});

function getTargetSize(image) {
  if (resolutionPreset.value === "native") {
    return snapToCharGrid(image.width, image.height);
  }

  const [maxWidth, maxHeight] =
    resolutionPreset.value === "custom"
      ? [Number(customWidth.value), Number(customHeight.value)]
      : resolutionPreset.value.split("x").map(Number);

  const scale = Math.min(maxWidth / image.width, maxHeight / image.height);
  return snapToCharGrid(image.width * scale, image.height * scale);
}

function snapToCharGrid(width, height) {
  return {
    width: Math.max(CHAR_PIXEL_SIZE, Math.round(width / CHAR_PIXEL_SIZE) * CHAR_PIXEL_SIZE),
    height: Math.max(CHAR_PIXEL_SIZE, Math.round(height / CHAR_PIXEL_SIZE) * CHAR_PIXEL_SIZE),
  };
}

function drawInputPreview(image) {
  inputCanvas.width = image.width;
  inputCanvas.height = image.height;
  const context = inputCanvas.getContext("2d");
  context.clearRect(0, 0, image.width, image.height);
  context.drawImage(image, 0, 0);
}

function drawScaledImage(image, width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.imageSmoothingQuality = "high";
  context.drawImage(image, 0, 0, width, height);
  return context.getImageData(0, 0, width, height);
}

function renderAscii(imageData, tolerance) {
  const { width, height, data } = imageData;
  const gray = toGrayscale(data, width, height);
  const dog = normalize(subtractClamped(gaussianBlur(gray, width, height, 1), gaussianBlur(gray, width, height, 4)));
  const edges = sobel(dog, width, height);
  const normalizedMagnitude = normalize(edges.magnitude);
  const columns = Math.floor(width / CHAR_PIXEL_SIZE);
  const rows = Math.floor(height / CHAR_PIXEL_SIZE);
  const cells = [];
  const lines = [];
  const brightnessCells = normalize(downsample(gray, width, columns, rows));

  for (let row = 0; row < rows; row += 1) {
    const line = [];
    for (let column = 0; column < columns; column += 1) {
      const cellIndex = row * columns + column;
      const sampleX = Math.min(width - 1, column * CHAR_PIXEL_SIZE + Math.floor(CHAR_PIXEL_SIZE / 2));
      const sampleY = Math.min(height - 1, row * CHAR_PIXEL_SIZE + Math.floor(CHAR_PIXEL_SIZE / 2));
      const sampleIndex = sampleY * width + sampleX;
      let char = CHARS[Math.floor((brightnessCells[cellIndex] / 255) * CHARS.length) % CHARS.length];

      if (normalizedMagnitude[sampleIndex] > tolerance) {
        char = edgeChar(edges.angle[sampleIndex]);
      }

      cells.push(char);
      line.push(char);
    }
    lines.push(line.join(""));
  }

  return {
    cells,
    columns,
    rows,
    text: lines.join("\n"),
  };
}

function toGrayscale(data, width, height) {
  const gray = new Float32Array(width * height);
  for (let index = 0, pixel = 0; pixel < gray.length; index += 4, pixel += 1) {
    gray[pixel] = data[index] * 0.299 + data[index + 1] * 0.587 + data[index + 2] * 0.114;
  }
  return gray;
}

function downsample(gray, width, columns, rows) {
  const output = new Float32Array(columns * rows);

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      let total = 0;
      for (let y = 0; y < CHAR_PIXEL_SIZE; y += 1) {
        for (let x = 0; x < CHAR_PIXEL_SIZE; x += 1) {
          total += gray[(row * CHAR_PIXEL_SIZE + y) * width + column * CHAR_PIXEL_SIZE + x];
        }
      }
      output[row * columns + column] = total / (CHAR_PIXEL_SIZE * CHAR_PIXEL_SIZE);
    }
  }

  return output;
}

function gaussianBlur(source, width, height, sigma) {
  const radius = Math.ceil(sigma * 3);
  const kernel = gaussianKernel(radius, sigma);
  const horizontal = new Float32Array(source.length);
  const output = new Float32Array(source.length);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let total = 0;
      for (let offset = -radius; offset <= radius; offset += 1) {
        total += source[y * width + clamp(x + offset, 0, width - 1)] * kernel[offset + radius];
      }
      horizontal[y * width + x] = total;
    }
  }

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let total = 0;
      for (let offset = -radius; offset <= radius; offset += 1) {
        total += horizontal[clamp(y + offset, 0, height - 1) * width + x] * kernel[offset + radius];
      }
      output[y * width + x] = total;
    }
  }

  return output;
}

function gaussianKernel(radius, sigma) {
  const kernel = new Float32Array(radius * 2 + 1);
  let total = 0;

  for (let offset = -radius; offset <= radius; offset += 1) {
    const value = Math.exp(-(offset * offset) / (2 * sigma * sigma));
    kernel[offset + radius] = value;
    total += value;
  }

  for (let index = 0; index < kernel.length; index += 1) {
    kernel[index] /= total;
  }

  return kernel;
}

function subtractClamped(left, right) {
  const output = new Float32Array(left.length);
  for (let index = 0; index < left.length; index += 1) {
    output[index] = Math.max(0, left[index] - right[index]);
  }
  return output;
}

function sobel(source, width, height) {
  const magnitude = new Float32Array(source.length);
  const angle = new Float32Array(source.length);

  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const topLeft = source[(y - 1) * width + x - 1];
      const top = source[(y - 1) * width + x];
      const topRight = source[(y - 1) * width + x + 1];
      const left = source[y * width + x - 1];
      const right = source[y * width + x + 1];
      const bottomLeft = source[(y + 1) * width + x - 1];
      const bottom = source[(y + 1) * width + x];
      const bottomRight = source[(y + 1) * width + x + 1];
      const gx = -topLeft - 2 * left - bottomLeft + topRight + 2 * right + bottomRight;
      const gy = -topLeft - 2 * top - topRight + bottomLeft + 2 * bottom + bottomRight;
      const index = y * width + x;

      magnitude[index] = Math.hypot(gx, gy);
      angle[index] = Math.atan2(gy, gx);
    }
  }

  return { magnitude, angle };
}

function normalize(source) {
  let min = Infinity;
  let max = -Infinity;

  for (const value of source) {
    min = Math.min(min, value);
    max = Math.max(max, value);
  }

  if (max === min) {
    return new Float32Array(source.length);
  }

  const output = new Float32Array(source.length);
  for (let index = 0; index < source.length; index += 1) {
    output[index] = ((source[index] - min) / (max - min)) * 255;
  }
  return output;
}

function edgeChar(radians) {
  const degrees = ((radians * 180) / Math.PI + 180) % 180;
  if (degrees > 22.5 && degrees <= 67.5) {
    return "/";
  }
  if (degrees > 67.5 && degrees <= 112.5) {
    return "-";
  }
  if (degrees > 112.5 && degrees <= 157.5) {
    return "\\";
  }
  return "|";
}

function drawAsciiCanvas(render) {
  outputCanvas.width = render.columns * CHAR_PIXEL_SIZE;
  outputCanvas.height = render.rows * CHAR_PIXEL_SIZE;
  const context = outputCanvas.getContext("2d");

  context.fillStyle = "#000";
  context.fillRect(0, 0, outputCanvas.width, outputCanvas.height);
  context.fillStyle = "#fff";
  context.font = `${CHAR_PIXEL_SIZE}px Consolas, monospace`;
  context.textBaseline = "top";

  render.cells.forEach((char, index) => {
    const x = (index % render.columns) * CHAR_PIXEL_SIZE;
    const y = Math.floor(index / render.columns) * CHAR_PIXEL_SIZE;
    context.fillText(char, x, y);
  });
}

function setStatus(message) {
  statusText.textContent = message;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
