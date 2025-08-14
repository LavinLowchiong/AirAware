import React, { useState, useEffect, useMemo } from "react";
import { MapContainer, TileLayer, Marker, Popup } from "react-leaflet";
import { HashRouter as Router, Route, Link, Routes } from "react-router-dom";
import { ChevronDown, ChevronUp } from "lucide-react";
import "leaflet/dist/leaflet.css";
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, query, orderBy, limit, getDocs, onSnapshot } from 'firebase/firestore';
import L from 'leaflet';

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// Helper function to validate and parse timestamp
const validateTimestamp = (timestamp) => {
  if (!timestamp) return null;
  
  let date;
  
  // Handle Firestore timestamp objects
  if (timestamp && typeof timestamp === 'object' && timestamp.seconds) {
    date = new Date(timestamp.seconds * 1000);
  } 
  // Handle ISO string timestamps
  else if (typeof timestamp === 'string') {
    date = new Date(timestamp);
  }
  // Handle regular Date objects or numbers
  else {
    date = new Date(timestamp);
  }
  
  // Check if date is valid and from 2025 or later
  if (isNaN(date.getTime())) return null;
  if (date.getFullYear() < 2025) return null;
  
  return date;
};

// Helper function to filter valid readings
const filterValidReadings = (readings) => {
  return readings.filter(reading => {
    const validDate = validateTimestamp(reading.timestamp);
    return validDate !== null;
  }).map(reading => ({
    ...reading,
    validTimestamp: validateTimestamp(reading.timestamp)
  })).sort((a, b) => b.validTimestamp.getTime() - a.validTimestamp.getTime());
};

// Helper function to calculate distance between two points in meters
const calculateDistance = (lat1, lon1, lat2, lon2) => {
  const R = 6371e3; // Earth's radius in meters
  const φ1 = lat1 * Math.PI/180;
  const φ2 = lat2 * Math.PI/180;
  const Δφ = (lat2-lat1) * Math.PI/180;
  const Δλ = (lon2-lon1) * Math.PI/180;

  const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
          Math.cos(φ1) * Math.cos(φ2) *
          Math.sin(Δλ/2) * Math.sin(Δλ/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

  return R * c; // Distance in meters
};

// Group locations within 5-meter radius
const groupLocationsByProximity = (readings) => {
  // First filter out invalid readings
  const validReadings = filterValidReadings(readings);
  
  const groups = [];
  
  validReadings.forEach(reading => {
    let foundGroup = false;
    
    for (let group of groups) {
      const distance = calculateDistance(
        reading.latitude, reading.longitude,
        group.latitude, group.longitude
      );
      
      if (distance <= 5) { // 5 meter threshold
        group.readings.push(reading);
        foundGroup = true;
        break;
      }
    }
    
    if (!foundGroup) {
      groups.push({
        latitude: reading.latitude,
        longitude: reading.longitude,
        readings: [reading]
      });
    }
  });
  
  return groups.slice(0, 5); // Return only top 5 location groups
};

// Custom marker icons
const createCustomIcon = (isLatest) => {
  const color = isLatest ? 'blue' : 'orange';
  return L.divIcon({
    html: `<div style="background-color: ${color}; width: 25px; height: 25px; border-radius: 50% 50% 50% 0; transform: rotate(-45deg); border: 2px solid white; box-shadow: 0 2px 4px rgba(0,0,0,0.3);"></div>`,
    className: 'custom-div-icon',
    iconSize: [25, 25],
    iconAnchor: [12, 25],
  });
};

const calculateAQI = (pm1, pm25, pm10) => {
  // Use PM2.5 as primary indicator (most common standard)
  let aqi = 0;
  
  if (pm25 <= 12) {
    aqi = Math.round((50 / 12) * pm25);
  } else if (pm25 <= 35.4) {
    aqi = Math.round(51 + ((100 - 51) / (35.4 - 12.1)) * (pm25 - 12.1));
  } else if (pm25 <= 55.4) {
    aqi = Math.round(101 + ((150 - 101) / (55.4 - 35.5)) * (pm25 - 35.5));
  } else if (pm25 <= 150.4) {
    aqi = Math.round(151 + ((200 - 151) / (150.4 - 55.5)) * (pm25 - 55.5));
  } else if (pm25 <= 250.4) {
    aqi = Math.round(201 + ((300 - 201) / (250.4 - 150.5)) * (pm25 - 150.5));
  } else {
    aqi = Math.round(301 + ((500 - 301) / (500 - 250.5)) * (pm25 - 250.5));
  }
  
  return Math.min(aqi, 500);
};

const getAQIStatus = (aqi) => {
  if (aqi <= 50) return { status: 'Good', advice: 'Enjoy outdoor activities freely.' };
  if (aqi <= 100) return { status: 'Moderate', advice: 'Sensitive groups should limit prolonged outdoor exertion.' };
  if (aqi <= 150) return { status: 'Unhealthy for Sensitive Groups', advice: 'Sensitive individuals should reduce outdoor activity.' };
  if (aqi <= 200) return { status: 'Unhealthy', advice: 'Everyone should limit prolonged outdoor exertion.' };
  if (aqi <= 250) return { status: 'Very Unhealthy', advice: 'Avoid outdoor activities; wear masks if going outside.' };
  if (aqi <= 300) return { status: 'Severe', advice: 'Stay indoors; use air purifiers and avoid any outdoor exposure.' };
  return { status: 'Hazardous', advice: 'Remain indoors with sealed windows and avoid all outdoor activities.' };
};

const getAQIRange = (aqi) => {
  if (aqi <= 50) return 'AQI (0-50)';
  if (aqi <= 100) return 'AQI (51-100)';
  if (aqi <= 150) return 'AQI (101-150)';
  if (aqi <= 200) return 'AQI (151-200)';
  if (aqi <= 250) return 'AQI (201-250)';
  if (aqi <= 300) return 'AQI (251-300)';
  return 'AQI (301-500)';
};

const getAQIRangeClass = (aqi) => {
  if (aqi <= 50) return 'good';
  if (aqi <= 100) return 'moderate';
  if (aqi <= 150) return 'unhealthy-sensitive';
  if (aqi <= 200) return 'unhealthy';
  if (aqi <= 250) return 'very-unhealthy';
  return 'hazardous';
};

const App = () => {
  const [currentData, setCurrentData] = useState(null);
  const [historyData, setHistoryData] = useState([]);
  const [isHistoryExpanded, setIsHistoryExpanded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [locationGroups, setLocationGroups] = useState([]);
  const [selectedLocationGroup, setSelectedLocationGroup] = useState(null);
  const [locationHistoryData, setLocationHistoryData] = useState([]);

  // Fetch data from Firebase
  useEffect(() => {
    const fetchData = async () => {
      try {
        // Get a larger sample to account for filtering out invalid dates
        const allReadingsQuery = query(
          collection(db, 'sensorReadings'), 
          orderBy('timestamp', 'desc'), 
          limit(100) // Increased limit to account for filtering
        );
        
        const allReadingsSnapshot = await getDocs(allReadingsQuery);
        const allReadings = [];
        
        allReadingsSnapshot.forEach((doc) => {
          const data = doc.data();
          
          // Validate timestamp before processing
          const validDate = validateTimestamp(data.timestamp);
          if (!validDate) {
            console.warn('Skipping reading with invalid timestamp:', data.timestamp);
            return; // Skip this reading
          }
          
          allReadings.push({
            id: doc.id,
            latitude: data.latitude || 6.791164,
            longitude: data.longitude || 79.900497,
            temperature: data.temperature || 0,
            humidity: data.humidity || 0,
            voc: data.voc || 0,
            pm25: data.pm25 || 0,
            pm10: data.pm10 || 0,
            pm1: data.pm1 || 0,
            rainfall: data.rainfall || 0,
            windSpeed: data.windSpeed || 0,
            windDirection: data.windDirection || 'N',
            co2: data.co2 || 0,
            deviceId: data.deviceId || '',
            timestamp: data.timestamp,
            validTimestamp: validDate,
            aqi: calculateAQI(data.pm1 || 0, data.pm25 || 0, data.pm10 || 0),
          });
        });

        // Sort by valid timestamp (most recent first)
        allReadings.sort((a, b) => b.validTimestamp.getTime() - a.validTimestamp.getTime());

        console.log(`Found ${allReadings.length} valid readings from 2025 or later`);

        // Group locations by proximity
        const groups = groupLocationsByProximity(allReadings);
        setLocationGroups(groups);

        // Set current data as the most recent valid reading
        if (allReadings.length > 0) {
          setCurrentData(allReadings[0]);
          console.log('Current data timestamp:', allReadings[0].validTimestamp.toISOString());
        } else {
          console.warn('No valid readings found, using fallback data');
          // Fallback data if no valid documents found
          setCurrentData({
            latitude: 6.791164,
            longitude: 79.900497,
            temperature: 30,
            humidity: 80,
            voc: 140,
            pm25: 40,
            pm10: 0,
            pm1: 0,
            rainfall: 0,
            windSpeed: 0,
            windDirection: 'N',
            co2: 0,
            deviceId: '',
            timestamp: new Date().toISOString(),
            validTimestamp: new Date(),
            aqi: calculateAQI(0, 40, 0),
          });
        }

        // Set history data (skip the first reading, take next 5)
        setHistoryData(allReadings.slice(1, 6));
      } catch (error) {
        console.error('Error fetching data from Firestore:', error);
        // Fallback data on error
        const fallbackDate = new Date();
        setCurrentData({
          latitude: 6.791164,
          longitude: 79.900497,
          temperature: 30,
          humidity: 80,
          voc: 140,
          pm25: 40,
          pm10: 0,
          pm1: 0,
          rainfall: 0,
          windSpeed: 0,
          windDirection: 'N',
          co2: 0,
          deviceId: '',
          timestamp: fallbackDate.toISOString(),
          validTimestamp: fallbackDate,
          aqi: calculateAQI(0, 40, 0),
        });
      } finally {
        setLoading(false);
      }
    };

    fetchData();
    
    // Set up real-time listener for new data
    const q = query(
      collection(db, 'sensorReadings'), 
      orderBy('timestamp', 'desc'), 
      limit(10) // Get more to filter
    );
    
    const unsubscribe = onSnapshot(q, (querySnapshot) => {
      const validReadings = [];
      
      querySnapshot.forEach((doc) => {
        const data = doc.data();
        const validDate = validateTimestamp(data.timestamp);
        
        if (validDate) {
          validReadings.push({
            id: doc.id,
            latitude: data.latitude || 6.791164,
            longitude: data.longitude || 79.900497,
            temperature: data.temperature || 0,
            humidity: data.humidity || 0,
            voc: data.voc || 0,
            pm25: data.pm25 || 0,
            pm10: data.pm10 || 0,
            pm1: data.pm1 || 0,
            rainfall: data.rainfall || 0,
            windSpeed: data.windSpeed || 0,
            windDirection: data.windDirection || 'N',
            co2: data.co2 || 0,
            deviceId: data.deviceId || '',
            timestamp: data.timestamp,
            validTimestamp: validDate,
            aqi: calculateAQI(data.pm1 || 0, data.pm25 || 0, data.pm10 || 0),
          });
        }
      });
      
      // Sort by valid timestamp and take the most recent
      validReadings.sort((a, b) => b.validTimestamp.getTime() - a.validTimestamp.getTime());
      
      if (validReadings.length > 0) {
        console.log('Real-time update - new valid reading:', validReadings[0].validTimestamp.toISOString());
        setCurrentData(validReadings[0]);
      }
    });

    // Cleanup subscription on unmount
    return () => unsubscribe();
  }, []);

  const airQualityMarkers = useMemo(() => {
    return locationGroups.map((group, index) => ({
      id: `location-${index}`,
      latitude: group.latitude,
      longitude: group.longitude,
      isLatest: index === 0,
      ...group.readings[0] // Use the most recent reading from this location
    }));
  }, [locationGroups]);

  const NavigationBar = () => (
    <nav className="nav">
      <h2 className="nav-title">Air Aware</h2>
      <div className="nav-links">
        <Link to="/" className="nav-link">Home</Link>
        <Link to="/insights" className="nav-link">Insights</Link>
      </div>
    </nav>
  );

  const InsightsPage = () => (
    <div className="insights-page">
      <NavigationBar />
      <div className="insights-content">
        {/* Welcome Section */}
        <div className="welcome-section">
          <div className="welcome-image">
            <img 
              src="forest.jpg" 
              alt="Forest" 
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'cover'
              }}
            />
            <div className="aqi-overlay-insights">
              <h2 className="aqi-title">AIR QUALITY INDEX</h2>
              <div className="aqi-main-card">
                <div className="aqi-left">
                  <div className="aqi-label">Live AQI</div>
                  <div className="aqi-value">{currentData ? calculateAQI(currentData.pm1, currentData.pm25, currentData.pm10) : '00'}</div>
                </div>
                <div className="aqi-right">
                  <div className="aqi-temp">🌡️ {currentData?.temperature || 0}°C</div>
                  <div className="aqi-status">Status: {currentData ? getAQIStatus(calculateAQI(currentData.pm1, currentData.pm25, currentData.pm10)).status : 'Good'}</div>
                </div>
              </div>
              <div className="aqi-advice-card">
                <div className={`aqi-range ${currentData ? getAQIRangeClass(calculateAQI(currentData.pm1, currentData.pm25, currentData.pm10)) : 'good'}`}>
                  {currentData ? getAQIRange(calculateAQI(currentData.pm1, currentData.pm25, currentData.pm10)) : 'AQI (0-50)'}
                </div>
                <div className="aqi-advice">{currentData ? getAQIStatus(calculateAQI(currentData.pm1, currentData.pm25, currentData.pm10)).advice : 'Enjoy outdoor activities freely.'}</div>
              </div>
            </div>
          </div>
          <div className="welcome-text">
            <p>
              Welcome to Air Aware, your trusted companion for real-time air quality monitoring. Our
              platform displays accurate data on temperature, humidity, VOC levels, and PM2.5 concentrations,
              tailored to your current location. Explore interactive maps, gain valuable insights, and stay
              informed about the air quality in your area and beyond. Designed with user-friendliness in
              mind, Air Aware empowers you to make better decisions for your health and the environment.
              Whether you're planning outdoor activities or tracking air trends, we're here to help you
              breathe easier and live smarter.
            </p>
          </div>
        </div>

        {/* Current Sensor Readings */}
        <div className="sensor-section">
          <h2 className="section-title">Current Sensor Readings</h2>
          <div className="sensor-grid">
            <div className="sensor-card temperature">
              <h3>Temperature</h3>
              <div className="sensor-value">{currentData?.temperature || 0}°C</div>
            </div>
            <div className="sensor-card humidity">
              <h3>Humidity</h3>
              <div className="sensor-value">{currentData?.humidity || 0}%</div>
            </div>
            <div className="sensor-card rainfall">
              <h3>Rainfall</h3>
              <div className="sensor-value">{currentData?.rainfall || 0}mm</div>
            </div>
            <div className="sensor-card wind-speed">
              <h3>Wind Speed</h3>
              <div className="sensor-value">{currentData?.windSpeed || 0}m/s</div>
            </div>
            <div className="sensor-card wind-direction">
              <h3>Wind Direction</h3>
              <div className="sensor-value">{currentData?.windDirection || 'N'}</div>
            </div>
          </div>
        </div>

        {/* VOC Section */}
        <div className="voc-section">
          <div className="section-content">
            <div className="section-text">
              <h2>Volatile Organic Compounds (VOC)</h2>
              <div className="voc-display">
                <div className="voc-value">{currentData?.voc || 0} ppb</div>
              </div>
              <p>
                Volatile Organic Compounds (VOCs) are organic chemicals that easily evaporate into the air and can
                significantly impact indoor and outdoor air quality. They are commonly released from products such as
                paints, cleaning supplies, and industrial processes. Prolonged exposure to high levels of VOCs can cause
                adverse health effects, including respiratory issues, headaches, and irritation of the eyes, nose, and throat.
                Maintaining VOC levels within a healthy range is crucial for well-being. Ideally, VOC concentrations should
                remain below 500 parts per billion (ppb) in indoor environments, with levels below 200 ppb being optimal
                for sensitive individuals.
              </p>
            </div>
          </div>
        </div>

        {/* PM Section */}
        <div className="pm-section">
          <div className="section-content">
            <div className="section-text">
              <h2>Particulate Matter (PM 2.5, PM 10)</h2>
              <div className="pm-display">
                <div className="pm-card">
                  <div className="pm-label">PM1.0</div>
                  <div className="pm-value">{currentData?.pm1 || 0}μg/m³</div>
                </div>
                <div className="pm-card">
                  <div className="pm-label">PM2.5</div>
                  <div className="pm-value">{currentData?.pm25 || 0}μg/m³</div>
                </div>
                <div className="pm-card">
                  <div className="pm-label">PM10</div>
                  <div className="pm-value">{currentData?.pm10 || 0}μg/m³</div>
                </div>
              </div>
              <p>
                Particulate Matter (PM) refers to tiny particles in the air that can harm human health when inhaled. PM2.5
                consists of fine particles with a diameter of 2.5 micrometers or smaller, while PM10 includes slightly
                larger particles up to 10 micrometers. These particles can originate from sources like vehicle emissions,
                industrial processes, and natural events such as wildfires or dust storms. PM2.5 is particularly concerning as it
                can penetrate deep into the lungs and even enter the bloodstream. For healthy air quality, PM2.5 levels should
                ideally remain below 12 µg/m³ while PM10 levels should stay below 50 µg/m³, based on 24-hour average standards.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  const HomePage = () => {
    if (loading || !currentData) {
      return (
        <div className="home-page">
          <NavigationBar />
          <div className="loading">Loading...</div>
        </div>
      );
    }

    return (
      <div className="home-page">
        <NavigationBar />
        <MapContainer
          center={[currentData.latitude, currentData.longitude]}
          zoom={15}
          className="map-container"
          zoomControl={false}
        >
          <TileLayer
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          />
          {airQualityMarkers.map((marker) => (
            <Marker 
              key={marker.id} 
              position={[marker.latitude, marker.longitude]}
              icon={createCustomIcon(marker.isLatest)}
              eventHandlers={{
                click: () => {
                  // Find the location group for this marker
                  const groupIndex = parseInt(marker.id.split('-')[1]);
                  const selectedGroup = locationGroups[groupIndex];
                  setSelectedLocationGroup(selectedGroup);
                  
                  // Load history for this location
                  setLocationHistoryData(selectedGroup.readings.slice(0, 5));
                }
              }}
            >
              <Popup>
                <AirQualityPopup marker={marker} />
              </Popup>
            </Marker>
          ))}
        </MapContainer>

        <div className="location-info">
          <h3>Current Location</h3>
          <p>Lat: {currentData.latitude}<br />Lng: {currentData.longitude}</p>
          <div style={{ marginBottom: '10px' }}></div>
          <h3>Air Quality Data</h3>
          <AirQualityData location={currentData} />
          {currentData.validTimestamp && (
            <div className="timestamp-info">
              <small>Last Updated: {currentData.validTimestamp.toLocaleString()}</small>
            </div>
          )}
        </div>

        <div className="history-panel">
          <div className="history-header" onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setIsHistoryExpanded(!isHistoryExpanded);
        }}
        >
            <h3>History</h3>
            {isHistoryExpanded ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
          </div>
          {isHistoryExpanded && (
            <div className="history-content">
              {(selectedLocationGroup ? locationHistoryData : historyData).length > 0 ? (
                (selectedLocationGroup ? locationHistoryData : historyData).slice(0, 5).map((data, index) => (
                  <div key={data.id || `history-${index}`} className="history-item">
                    <div className="history-time">
                      {data.validTimestamp ? data.validTimestamp.toLocaleString() : 'Invalid date'}
                    </div>
                    <div className="history-values">
                      <span>T: {data.temperature}°C</span>
                      <span>H: {data.humidity}%</span>
                      <span>VOC: {data.voc}ppb</span>
                      <span>PM2.5: {data.pm25}μg/m³</span>
                    </div>
                  </div>
                ))
              ) : (
                <div className="history-item">
                  <div className="history-time">No historical data available</div>
                </div>
              )}
              {selectedLocationGroup && (
                <div className="location-info-small">
                  <small>Showing history for location: {selectedLocationGroup.latitude.toFixed(4)}, {selectedLocationGroup.longitude.toFixed(4)}</small>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    );
  };

  const AirQualityPopup = ({ marker }) => (
    <div>
      <h4>Air Quality Details</h4>
      <div className="popup-data">
        <p><strong>Temperature:</strong> {marker.temperature}°C</p>
        <p><strong>Humidity:</strong> {marker.humidity}%</p>
        <p><strong>VOC:</strong> {marker.voc} ppb</p>
        <p><strong>PM2.5:</strong> {marker.pm25} μg/m³</p>
        <p><strong>PM10:</strong> {marker.pm10} μg/m³</p>
        <p><strong>PM1:</strong> {marker.pm1} μg/m³</p>
        <p><strong>Last Updated:</strong> {marker.validTimestamp ? marker.validTimestamp.toLocaleString() : 'Invalid date'}</p>
      </div>
    </div>
  );

  const AirQualityData = ({ location }) => (
    <div className="air-quality-data">
      <div className="data-item"><strong>Temperature:</strong> {location.temperature}°C</div>
      <div className="data-item"><strong>Humidity:</strong> {location.humidity}%</div>
      <div className="data-item"><strong>VOC:</strong> {location.voc} ppb</div>
      <div className="data-item"><strong>PM2.5:</strong> {location.pm25} μg/m³</div>
      <div className="data-item"><strong>PM10:</strong> {location.pm10} μg/m³</div>
      <div className="data-item"><strong>PM1:</strong> {location.pm1} μg/m³</div>
    </div>
  );

  return (
    <Router>
      <div className="app">
        <style>{`
          * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
          }
          
          .aqi-range.good { color: #00e400; }
          .aqi-range.moderate { color: #ffff00; }
          .aqi-range.unhealthy-sensitive { color: #ff7e00; }
          .aqi-range.unhealthy { color: #ff0000; }
          .aqi-range.very-unhealthy { color: #8f3f97; }
          .aqi-range.hazardous { color: #7e0023; }

          .leaflet-container {
            background: transparent !important;
          }

          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            border: none;
            outline: none;  
            background: #f5f5f5;
            margin: 0;
            padding: 0;
          }

          @import url('https://fonts.googleapis.com/css2?family=Anton&family=Antic+Slab&display=swap');

          h1, h2, h3, h4, h5, h6 {
            font-family: 'Anton', sans-serif;
          }

          p {
            text-align: center;
          }

          .app {
            min-height: 100vh;
            border: none;
            outline: none;
          }

          .nav {
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            background: #000;
            color: white;
            padding: 15px 20px;
            z-index: 1000;
            display: flex;
            justify-content: space-between;
            align-items: center;
            box-shadow: 0 1px 0 #000;
            margin: 0;
            border: none;
            height: 70px;
            box-sizing: border-box;
          }

          .nav-title {
            font-size: 32px;
            font-weight: bold;
          }

          .nav-links {
            display: flex;
            gap: 30px;
          }

          .nav-link {
            color: white;
            text-decoration: none;
            font-size: 18px;
            transition: opacity 0.3s;
          }

          .nav-link:hover {
            opacity: 0.8;
          }

          .home-page {
            min-height: 100vh;
            position: relative;
            border: none;
            position: relative;
            overflow: hidden;
          }

          .map-container {
            height: calc(100vh - 70px);
            width: 100%;
            margin-top: 70px;
            top: -1px;
          }

          .location-info {
            position: absolute;
            top: 90px;
            left: 20px;
            width: 280px;
            background: rgba(255, 255, 255, 0.95);
            padding: 16px;
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
            z-index: 1000;
          }

          .location-info h3 {
            margin-bottom: 8px;
            color: #333;
          }

          .location-info p {
            text-align: left;
            margin-left: 10px;
          }

          .timestamp-info {
            margin-top: 10px;
            padding: 8px;
            background: #f0f8ff;
            border-radius: 4px;
            border-left: 3px solid #007bff;
          }

          .timestamp-info small {
            color: #666;
            font-size: 12px;
          }

          .air-quality-data {
            margin-top: 10px;
          }

          .data-item {
            margin: 4px 0;
            font-size: 14px;
          }

          .history-panel {
            position: absolute;
            top: 90px;
            right: 20px;
            width: calc(50vw - 30px);
            max-width: 200px;
            background: rgba(255, 255, 255, 0.95);
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
            z-index: 1000;
          }

          .history-header {
            padding: 16px;
            cursor: pointer;
            display: flex;
            justify-content: space-between;
            align-items: center;
            border-bottom: 1px solid #eee;
          }

          .history-header:hover {
            background: rgba(0, 0, 0, 0.05);
          }

          .history-content {
            max-height: 300px;
            overflow-y: auto;
          }

          .history-item {
            padding: 12px 16px;
            border-bottom: 1px solid #eee;
          }

          .history-time {
            font-size: 12px;
            color: #666;
            margin-bottom: 4px;
          }

          .history-values {
            display: flex;
            gap: 8px;
            flex-wrap: wrap;
          }

          .history-values span {
            font-size: 11px;
            background: #f0f0f0;
            padding: 2px 6px;
            border-radius: 3px;
          }

          .location-info-small {
            padding: 8px 16px;
            background: #f8f9fa;
            border-top: 1px solid #eee;
            font-size: 10px;
            color: #666;
            text-align: center;
          }

          .insights-page {
            min-height: 100vh;
            background: #f5f5f5;
            overflow-y: auto;
            border: none;
          }

          .insights-content {
            padding-top: 70px;
          }

          .welcome-section {
            display: flex;
            background: #2FB728;
            color: white;
            min-height: 300px;
          }

          .welcome-text {
            flex: 1;
            padding: 40px;
            display: flex;
            align-items: center;
            text-align: center;
          }

          .welcome-text p {
            font-size: 24px;
            line-height: 1.6;
            font-family: 'Antic', serif;
          }

          .sensor-section {
            padding: 40px;
            background: #000;
            color: white;
          }

          .section-title {
            text-align: center;
            font-size: 28px;
            margin-bottom: 30px;
          }

          .sensor-grid {
            display: grid;
            grid-template-columns: repeat(5, 1fr);
            gap: 20px;
            max-width: 1000px;
            margin: 0 auto;
          }

          .sensor-card {
            padding: 20px;
            border-radius: 8px;
            text-align: center;
          }

          .sensor-card.temperature { background: #FF6262; }
          .sensor-card.humidity { background: #A4ACB5; }
          .sensor-card.rainfall { background: #8FA2FF; }
          .sensor-card.wind-speed { background: #19C695; }
          .sensor-card.wind-direction { background: #CCB954; }

          .sensor-card h3 {
            margin-bottom: 10px;
            font-size: 16px;
          }

          .sensor-value {
            font-size: 24px;
            font-weight: bold;
          }

          .voc-section {
            background: #2FB728;
            color: white;
            padding: 40px;
          }

          .pm-section {
            background: #000000ff;
            color: white;
            padding: 40px;
          }

          .section-content {
            max-width: 1200px;
            margin: 0 auto;
          }

          .section-text h2 {
            font-size: 28px;
            margin-bottom: 20px;
            text-align: center;
          }

          .section-text p {
            font-size: 16px;
            line-height: 1.6;
            margin-top: 20px;
          }

          .voc-display {
            display: flex;
            justify-content: center;
            margin: 20px 0;
          }

          .voc-value {
            background: rgba(255, 255, 255, 0.2);
            padding: 20px 40px;
            border-radius: 8px;
            font-size: 32px;
            font-weight: bold;
          }

          .pm-display {
            display: flex;
            justify-content: center;
            gap: 20px;
            margin: 20px 0;
            flex-wrap: wrap;
          }

          .pm-card {
            background: rgba(255, 255, 255, 0.2);
            padding: 15px 25px;
            border-radius: 8px;
            text-align: center;
            min-width: 120px;
          }

          .pm-label {
            font-size: 14px;
            opacity: 0.8;
            margin-bottom: 5px;
          }

          .pm-value {
            font-size: 20px;
            font-weight: bold;
          }

          @import url('https://fonts.googleapis.com/css2?family=Anton&family=Antic+Slab&display=swap');

          p {
            font-family: 'Antic Slab', serif;
            text-align: center;
          }

          .welcome-image {
            flex: 1;
            display: flex;
            align-items: center;
            justify-content: center;
            position: relative;
            
          }

          .aqi-overlay-insights {
            position: relative;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            text-align: center;
            color: white;
            z-index: 10;
            pointer-events: none;
            width: 90%;
            max-width: 350px;
            box-sizing: border-box;
          }

          .aqi-title {
            font-size: 28px;
            font-weight: bold;
            margin-bottom: 15px;
            text-shadow: 2px 2px 4px rgba(0,0,0,0.7);
            word-wrap: break-word;
            font-family: 'Anton', sans-serif;
          }

          .aqi-main-card {
            background: rgba(255, 255, 255, 0.2);
            backdrop-filter: blur(10px);
            border: 1px solid rgba(255, 255, 255, 0.3);
            border-radius: 15px;
            padding: 20px;
            margin-bottom: 15px;
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 10px;
            min-width: 0;
            box-sizing: border-box;
          }

          .aqi-left {
            text-align: left;
          }

          .aqi-label {
            font-size: 16px;
            margin-bottom: 8px;
            opacity: 0.9;
          }

          .aqi-value {
            font-size: 36px;
            font-weight: bold;
            word-break: break-all;
          }

          .aqi-right {
            text-align: right;
          }

          .aqi-temp {
            font-size: 20px;
            margin-bottom: 8px;
          }

          .aqi-status {
            font-size: 16px;
            font-weight: bold;
          }

          .aqi-details {
            display: flex;
            gap: 15px;
            margin-bottom: 15px;
            justify-content: center;
            flex-wrap: wrap;
            max-width: 100%;
          }

          .aqi-detail-item {
            background: rgba(255, 255, 255, 0.15);
            backdrop-filter: blur(5px);
            border-radius: 8px;
            padding: 8px 12px;
            font-size: 12px;
          }

          .aqi-advice-card {
            background: rgba(255, 255, 255, 0.2);
            backdrop-filter: blur(10px);
            border: 1px solid rgba(255, 255, 255, 0.3);
            border-radius: 15px;
            padding: 15px;
            max-width: 350px;
          }

          .aqi-range {
            font-size: 24px;
            font-weight: bold;
            margin-bottom: 5px;
          }

          .aqi-advice {
            font-size: 18px;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          }

          .custom-div-icon {
            background: transparent !important;
            border: none !important;
          }

          @media (max-width: 768px) {
            .aqi-main-card {
              min-width: unset;
              width: 100%;
              padding: 15px;
              flex-direction: column;
              text-align: center;
              gap: 10px;
            }
  
            .aqi-left, .aqi-right {
              text-align: center;
            }
  
            .aqi-title {
              font-size: 20px;
              margin-bottom: 10px;
            }
  
            .aqi-value {
              font-size: 28px;
            }

            .aqi-overlay-insights {
              position: absolute;
              top: 50%;
              left: 50%;
              transform: translate(-50%, -50%);
              width: 90%;
              max-width: 350px;
            }

            .aqi-temp {
              font-size: 18px;
              margin-bottom: 5px;
            } 

            .aqi-details {
              flex-wrap: wrap;
              gap: 8px;
              justify-content: center;
            }

            .aqi-detail-item {
              font-size: 11px;
              padding: 6px 8px;
            }

            .aqi-advice-card {
              width: 100%;
              max-width: unset;
              padding: 12px;
            }

            .aqi-range {
              font-size: 18px;
            }

            .aqi-advice {
              font-size: 14px;
            }
          }

          .popup-data p {
            margin: 4px 0;
            font-size: 14px;
          }

          .loading {
            display: flex;
            align-items: center;
            justify-content: center;
            height: 100vh;
            font-size: 24px;
          }

          @media (max-width: 768px) {
            .map-container {
              height: calc(100vh - 70px);
              margin-top: 70px;
              position: relative;
            }

            .nav {
              padding: 10px 15px;
              height: 70px;
            }

            .nav-title {
              font-size: 24px;
            }

            .nav-links {
              gap: 15px;
            }

            .nav-link {
              font-size: 16px;
            }

            .location-info {
              width: calc(50vw - 30px);
              max-width: 180px;
              top: 90px;
              left: 15px;
            }

            .history-panel {
              width: calc(50vw - 25px);
              max-width: 160px;
              top: 90px;
              right: 10px;
              left: auto;
            }

            .welcome-section {
              flex-direction: column;
              min-height: auto;
            }

            .welcome-image {
              height: 200px;
            }

            .welcome-text {
              padding: 20px;
            }

            .welcome-text p {
              font-size: 16px;
            }

            .sensor-section,
            .voc-section,
            .pm-section {
              padding: 20px;
            }

            .section-title {  
              font-size: 24px;
            }

            .sensor-grid {
              grid-template-columns: repeat(2, 1fr);
              gap: 15px;
            }

            .sensor-card {
              padding: 15px;
            }

            .sensor-value {
              font-size: 20px;
            }

            .section-text h2 {
              font-size: 24px;
            }

            .section-text p {
              font-size: 14px;
            }

            .voc-value {
              padding: 15px 30px;
              font-size: 24px;
            }

            .pm-display {
              gap: 10px;
            }

            .pm-card {
              padding: 10px 20px;
              min-width: 100px;
            }

            .pm-value {
              font-size: 18px;
            }

            width: 95%;
            padding: 0 10px;
          }

          .aqi-overlay-insights {
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            width: 90%;
            max-width: 320px;
          }

          .aqi-title {
            font-size: 22px;
            margin-bottom: 12px;
          }

          .aqi-main-card {
            min-width: unset;
            width: 100%;
            padding: 16px;
            flex-direction: column;
            text-align: center;
            gap: 12px;
          }

          .aqi-left, .aqi-right {
            text-align: center;
          }

          .aqi-value {
            font-size: 30px;
          }

          .aqi-temp {
            font-size: 18px;
            margin-bottom: 6px;
          }

          .aqi-details {
            flex-wrap: wrap;
            gap: 8px;
            justify-content: center;
          }

          .aqi-detail-item {
            font-size: 11px;
            padding: 6px 10px;
          }

          .aqi-advice-card {
            width: 100%;
            max-width: unset;
            padding: 14px;
          }

          .aqi-range {
            font-size: 20px;
          }

          .aqi-advice {
            font-size: 15px;
          }

          @media (max-width: 560px) {
            .aqi-overlay-insights {
              width: 95%;
              max-width: 280px;
              padding: 0 8px;
            }

            .aqi-title {
              font-size: 18px;
              margin-bottom: 8px;
            }

            .aqi-main-card {
              padding: 12px;
              border-radius: 12px;
              gap: 8px;
            }

            .aqi-value {
              font-size: 26px;
            }

            .aqi-label {
              font-size: 14px;
            }

            .aqi-temp {
              font-size: 16px;
            }

            .aqi-status {
              font-size: 14px;
            }

            .aqi-details {
              gap: 6px;
              margin-bottom: 10px;
            }

            .aqi-detail-item {
              font-size: 10px;
              padding: 4px 6px;
            }

            .aqi-advice-card {
              padding: 10px;
              border-radius: 10px;
            }

            .aqi-range {
              font-size: 16px;
              margin-bottom: 4px;
            }

            .aqi-advice {
              font-size: 12px;
              line-height: 1.3;
            }


          }

          @media (max-width: 480px) {
            .nav {
              box-shadow: 0 1px 0 #000;
              padding: 15px 20px;
              height: 70px;
              border: none;
              margin: 0
            }

            body{
              margin: 0;
              padding: 0;
            }

            .map-container {
              height: calc(100vh - 70px);
              margin-top: 70px;
              position: relative;
            }

            .nav-title {
              font-size: 20px;
            }

            .nav-link {
              font-size: 14px;
            }

            .location-info {
              width: calc(50vw - 15px);
              left: 10px;
              right: auto;
            }

            .history-panel {
              width: calc(50vw - 15px);
              right: 10px;
              left: auto;
              top: 80px;
            }

            .sensor-grid {
              grid-template-columns: 1fr 1fr;
            }

            .welcome-image {
              height: 150vw;

            }

            .aqi-overlay-insights {
              width: 100%;
              max-width: 260px;
              height:90%;
            }

            .aqi-title {
              font-size: 16px;
              margin-bottom: 6px;
            }

            .aqi-main-card {
              padding: 8px;
              border-radius: 10px;
              gap: 0px;
              margin-bottom: 6px;
            }

            .aqi-value {
              font-size: 14px;
            }

            .aqi-label {
              font-size: 14px;
              padding: 0px;
              margin-bottom: 0px;

            }

            .aqi-temp {
              font-size: 14px;
            }

            .aqi-status {
              font-size: 12px;
            }

            .aqi-details {
              gap: 4px;
              margin-bottom: 8px;
            }

            .aqi-detail-item {
              font-size: 9px;
              padding: 3px 5px;
            }

            .aqi-advice-card {
              padding: 4px;
              border-radius: 8px;
            }

            .aqi-range {
              font-size: 12px;
              margin-bottom: 3px;
            }

            .aqi-advice {
              font-size: 12px;
              line-height: 1.2;
            }

          }

          


        `}</style>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/insights" element={<InsightsPage />} />
        </Routes>
      </div>
    </Router>
  );
};

export default App;