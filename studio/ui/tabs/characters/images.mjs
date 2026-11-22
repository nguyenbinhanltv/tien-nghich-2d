// Image loading for the stage: decoded images and their pixels, cached per mount.
export function createImageStore() {
  const images = new Map(), pixels = new Map();
  const url = path => '/' + path.replace(/^\/+/, '');
  function load(path) {
    if (!images.has(path)) images.set(path, new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Could not load ' + path));
      img.src = url(path) + (path.includes('?') ? '' : '');
    }));
    return images.get(path);
  }
  async function read(path) {
    if (!pixels.has(path)) pixels.set(path, load(path).then(img => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
      const context = canvas.getContext('2d', {willReadFrequently: true});
      context.drawImage(img, 0, 0);
      const {data} = context.getImageData(0, 0, canvas.width, canvas.height);
      return {width: canvas.width, height: canvas.height, data};
    }));
    return pixels.get(path);
  }
  return {load, read, url, forget() { images.clear(); pixels.clear(); }};
}
