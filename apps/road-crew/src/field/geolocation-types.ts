/** A single GPS fix, shared by the web/native geolocation hooks. */
export interface Fix {
  lat: number;
  lng: number;
  speed: number | null;
  heading: number | null;
  accuracy: number | null;
  ts: number;
}
