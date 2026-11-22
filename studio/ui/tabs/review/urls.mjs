/** `assets/x y.png` → `/assets/x%20y.png` */
export const imgUrl = path => '/' + path.split('/').map(encodeURIComponent).join('/');
