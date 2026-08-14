// A physical bus stop. The Firestore document id is the stopId, and routes
// reference stops both by that id (startStopId / endStopId) and by name inside
// their ordered `stops` array.
export interface Stop {
    stopId: string;
    name: string;
    latitude: number;
    longitude: number;
}