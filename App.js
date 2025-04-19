"use client";

import { useState, useEffect, useRef, createContext, useContext } from "react";
import { StatusBar } from "expo-status-bar";
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  SafeAreaView,
  FlatList,
  ActivityIndicator,
  Image,
  Dimensions,
  Modal,
  ScrollView,
  PanResponder,
  Animated,
  Alert,
  Platform,
  TextInput,
  KeyboardAvoidingView,
  useColorScheme,
  Pressable,
  Vibration,
} from "react-native";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons } from "@expo/vector-icons";
import { NavigationContainer } from "@react-navigation/native";
import { createStackNavigator } from "@react-navigation/stack";
import { WebView } from "react-native-webview";
import JSZip from "jszip";
import { parseString } from "xml2js";
import { Audio } from "expo-av"; // Import Audio from expo-av for audio playback
import * as Haptics from "expo-haptics"; // Import Haptics for tactile feedback
import * as Sharing from "expo-sharing";
import * as MediaLibrary from "expo-media-library";

// Components
const Stack = createStackNavigator();
const { width, height } = Dimensions.get("window");

// Create a theme context
const ThemeContext = createContext();

// Theme provider component
const ThemeProvider = ({ children }) => {
  const [theme, setTheme] = useState("light");

  useEffect(() => {
    loadTheme();
  }, []);

  const loadTheme = async () => {
    try {
      const savedTheme = await AsyncStorage.getItem("theme");
      if (savedTheme) {
        setTheme(savedTheme);
      }
    } catch (error) {
      console.error("Error loading theme:", error);
    }
  };

  const toggleTheme = async () => {
    const newTheme = theme === "light" ? "dark" : "light";
    setTheme(newTheme);
    try {
      await AsyncStorage.setItem("theme", newTheme);
    } catch (error) {
      console.error("Error saving theme:", error);
    }
  };

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
};

// Library Screen to list books
const LibraryScreen = ({ navigation }) => {
  const [books, setBooks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [showSearch, setShowSearch] = useState(false);
  const [readingStats, setReadingStats] = useState({
    totalReadingTime: 0,
    streakDays: 0,
    lastReadDate: null,
  });
  const { theme, toggleTheme } = useContext(ThemeContext);
  const isDark = theme === "dark";

  // Animation values
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const searchBarAnim = useRef(new Animated.Value(0)).current;
  const statsAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    loadBooks();
    loadReadingStats();

    // Fade in animations
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 600,
        useNativeDriver: true,
      }),
      Animated.timing(statsAnim, {
        toValue: 1,
        duration: 800,
        useNativeDriver: true,
      }),
    ]).start();
  }, []);

  const loadBooks = async () => {
    try {
      const storedBooks = await AsyncStorage.getItem("books");
      if (storedBooks) {
        setBooks(JSON.parse(storedBooks));
      }
      setLoading(false);
    } catch (error) {
      console.error("Error loading books:", error);
      setLoading(false);
    }
  };

  const loadReadingStats = async () => {
    try {
      const stats = await AsyncStorage.getItem("readingStats");
      if (stats) {
        setReadingStats(JSON.parse(stats));
      }
    } catch (error) {
      console.error("Error loading reading stats:", error);
    }
  };

  const formatReadingTime = (minutes) => {
    if (minutes < 60) {
      return `${minutes} minutes`;
    }
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return `${hours}h ${remainingMinutes}m`;
  };

  const extractCoverFromEpub = async (epubPath) => {
    try {
      const epubData = await FileSystem.readAsStringAsync(epubPath, {
        encoding: FileSystem.EncodingType.Base64,
      });

      // Create a new JSZip instance
      const zip = new JSZip();
      // Load the ePub data
      const contents = await zip.loadAsync(epubData, { base64: true });

      // First look for container.xml to find the OPF file
      const containerFile = contents.file("META-INF/container.xml");
      if (!containerFile) {
        throw new Error("container.xml not found");
      }

      const containerXml = await containerFile.async("text");

      // Parse container.xml to find the OPF file path
      let opfPath = "";
      parseString(containerXml, (err, result) => {
        if (err) throw err;
        opfPath = result.container.rootfiles[0].rootfile[0].$["full-path"];
      });

      // Read the OPF file
      const opfFile = contents.file(opfPath);
      if (!opfFile) {
        throw new Error("OPF file not found");
      }

      const opfContent = await opfFile.async("text");

      // Parse OPF to find cover image
      let coverPath = "";
      parseString(opfContent, (err, result) => {
        if (err) throw err;

        // Try to find cover image
        const manifest = result.package.manifest[0].item;

        // First look for item with id="cover"
        const coverItem = manifest.find(
          (item) =>
            item.$["id"] === "cover" ||
            item.$["id"] === "cover-image" ||
            item.$["properties"] === "cover-image",
        );

        if (coverItem) {
          coverPath = coverItem.$["href"];
        } else {
          // Look for image items
          const imageItems = manifest.filter(
            (item) =>
              item.$["media-type"] && item.$["media-type"].startsWith("image/"),
          );

          if (imageItems.length > 0) {
            // Just use the first image as cover
            coverPath = imageItems[0].$["href"];
          }
        }
      });

      if (coverPath) {
        // Resolve relative path
        const opfDir = opfPath.substring(0, opfPath.lastIndexOf("/"));
        const fullCoverPath = opfDir ? `${opfDir}/${coverPath}` : coverPath;

        // Extract cover image
        const coverFile = contents.file(fullCoverPath);
        if (!coverFile) {
          throw new Error("Cover file not found");
        }

        const coverData = await coverFile.async("base64");

        // Save cover image
        const bookDir = epubPath.substring(0, epubPath.lastIndexOf("/") + 1);
        const coverFilePath = `${bookDir}cover.jpg`;

        await FileSystem.writeAsStringAsync(coverFilePath, coverData, {
          encoding: FileSystem.EncodingType.Base64,
        });

        return coverFilePath;
      }

      return null;
    } catch (error) {
      console.error("Error extracting cover:", error);
      return null;
    }
  };

  const pickDocument = async () => {
    try {
      // Trigger haptic feedback
      if (Platform.OS === "ios") {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }

      const result = await DocumentPicker.getDocumentAsync({
        type: "application/epub+zip",
        copyToCacheDirectory: true,
      });

      if (result.canceled) {
        return;
      }

      const { uri, name } = result.assets[0];
      const newBookId = Date.now().toString();
      const bookDir = `${FileSystem.documentDirectory}books/${newBookId}/`;

      // Create directory if it doesn't exist
      await FileSystem.makeDirectoryAsync(bookDir, { intermediates: true });

      // Copy the ePub file to our app's documents directory
      const newUri = `${bookDir}${name}`;
      await FileSystem.copyAsync({
        from: uri,
        to: newUri,
      });

      // Extract metadata and cover
      const coverUrl = await extractCoverFromEpub(newUri);

      // Add book to library
      const newBook = {
        id: newBookId,
        title: name.replace(".epub", ""),
        uri: newUri,
        coverUrl: coverUrl,
        lastOpenedAt: new Date().toISOString(),
        progress: 0,
        currentPage: 0,
        currentChapter: 0,
        totalPages: 0,
      };

      const updatedBooks = [...books, newBook];
      setBooks(updatedBooks);
      await AsyncStorage.setItem("books", JSON.stringify(updatedBooks));
    } catch (error) {
      console.error("Error picking document:", error);
    }
  };

  const removeBook = async (id) => {
    try {
      // Trigger haptic feedback
      if (Platform.OS === "ios") {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      }

      Alert.alert(
        "Remove Book",
        "Are you sure you want to remove this book from your library?",
        [
          {
            text: "Cancel",
            style: "cancel",
          },
          {
            text: "Remove",
            style: "destructive",
            onPress: async () => {
              const updatedBooks = books.filter((book) => book.id !== id);
              setBooks(updatedBooks);
              await AsyncStorage.setItem("books", JSON.stringify(updatedBooks));

              // Remove book files
              const bookDir = `${FileSystem.documentDirectory}books/${id}/`;
              await FileSystem.deleteAsync(bookDir, { idempotent: true });
            },
          },
        ],
      );
    } catch (error) {
      console.error("Error removing book:", error);
    }
  };

  const openBook = async (book) => {
    // Trigger haptic feedback
    if (Platform.OS === "ios") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }

    // Update the last opened timestamp
    const updatedBooks = books.map((b) =>
      b.id === book.id ? { ...b, lastOpenedAt: new Date().toISOString() } : b,
    );
    setBooks(updatedBooks);
    await AsyncStorage.setItem("books", JSON.stringify(updatedBooks));

    // Navigate to reader with page transition animation
    navigation.navigate("Reader", {
      book,
      transition: "fade", // Add transition type for better animations
    });
  };

  const toggleSearch = () => {
    setShowSearch(!showSearch);

    // Animate search bar
    Animated.timing(searchBarAnim, {
      toValue: showSearch ? 0 : 1,
      duration: 300,
      useNativeDriver: true,
    }).start();

    if (showSearch) {
      setSearchQuery("");
    }
  };

  const filteredBooks = books.filter((book) =>
    book.title.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  const formatDate = (dateString) => {
    const date = new Date(dateString);
    const now = new Date();

    // If it's today, show "Today"
    if (date.toDateString() === now.toDateString()) {
      return "Today";
    }

    // If it's yesterday, show "Yesterday"
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    if (date.toDateString() === yesterday.toDateString()) {
      return "Yesterday";
    }

    // Otherwise show the date
    return date.toLocaleDateString();
  };

  if (loading) {
    return (
      <View style={[styles.centeredContainer, isDark && styles.darkBackground]}>
        <ActivityIndicator
          size="large"
          color={isDark ? "#60A5FA" : "#007AFF"}
        />
      </View>
    );
  }

  return (
    <SafeAreaView style={[styles.container, isDark && styles.darkBackground]}>
      <View style={[styles.header, isDark && styles.darkHeader]}>
        <Text style={[styles.headerTitle, isDark && styles.darkText]}>
          Library
        </Text>
        <View style={styles.headerButtons}>
          <TouchableOpacity
            style={[styles.headerButton, isDark && styles.darkHeaderButton]}
            onPress={toggleTheme}
          >
            <Ionicons
              name={isDark ? "sunny" : "moon"}
              size={22}
              color={isDark ? "#60A5FA" : "#007AFF"}
            />
          </TouchableOpacity>
          {books.length > 0 && (
            <TouchableOpacity
              style={[styles.headerButton, isDark && styles.darkHeaderButton]}
              onPress={toggleSearch}
            >
              <Ionicons
                name={showSearch ? "close" : "search"}
                size={22}
                color={isDark ? "#60A5FA" : "#007AFF"}
              />
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={[styles.headerButton, isDark && styles.darkHeaderButton]}
            onPress={pickDocument}
          >
            <Ionicons
              name="add"
              size={24}
              color={isDark ? "#60A5FA" : "#007AFF"}
            />
          </TouchableOpacity>
        </View>
      </View>

      {/* Reading Statistics Widget */}
      {books.length > 0 && (
        <Animated.View
          style={[
            styles.statsContainer,
            isDark && styles.darkStatsContainer,
            {
              opacity: statsAnim,
              transform: [
                {
                  translateY: statsAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [20, 0],
                  }),
                },
              ],
            },
          ]}
        >
          <View style={styles.statItem}>
            <Ionicons
              name="time-outline"
              size={24}
              color={isDark ? "#60A5FA" : "#007AFF"}
            />
            <Text style={[styles.statValue, isDark && styles.darkText]}>
              {formatReadingTime(readingStats.totalReadingTime)}
            </Text>
            <Text style={[styles.statLabel, isDark && styles.darkSubText]}>
              Total Reading Time
            </Text>
          </View>
          <View style={styles.statItem}>
            <Ionicons
              name="flame-outline"
              size={24}
              color={isDark ? "#60A5FA" : "#007AFF"}
            />
            <Text style={[styles.statValue, isDark && styles.darkText]}>
              {readingStats.streakDays}
            </Text>
            <Text style={[styles.statLabel, isDark && styles.darkSubText]}>
              Day Streak
            </Text>
          </View>
        </Animated.View>
      )}

      {/* Search bar */}
      {showSearch && (
        <Animated.View
          style={[
            styles.searchContainer,
            isDark && styles.darkSearchContainer,
            {
              opacity: searchBarAnim,
              transform: [
                {
                  translateY: searchBarAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [-20, 0],
                  }),
                },
              ],
            },
          ]}
        >
          <View style={[styles.searchBar, isDark && styles.darkSearchBar]}>
            <Ionicons
              name="search"
              size={16}
              color={isDark ? "#9CA3AF" : "#8E8E93"}
              style={styles.searchIcon}
            />
            <TextInput
              style={[styles.searchInput, isDark && styles.darkSearchInput]}
              placeholder="Search books..."
              placeholderTextColor={isDark ? "#9CA3AF" : "#8E8E93"}
              value={searchQuery}
              onChangeText={setSearchQuery}
              autoFocus
              clearButtonMode="while-editing"
            />
          </View>
        </Animated.View>
      )}

      {books.length === 0 ? (
        <View style={[styles.emptyLibrary, isDark && styles.darkBackground]}>
          <View
            style={[
              styles.emptyIconContainer,
              isDark && styles.darkEmptyIconContainer,
            ]}
          >
            <Ionicons
              name="book-outline"
              size={80}
              color={isDark ? "#4B5563" : "#CCCCCC"}
            />
          </View>
          <Text style={[styles.emptyText, isDark && styles.darkText]}>
            Your library is empty
          </Text>
          <Text style={[styles.emptySubText, isDark && styles.darkSubText]}>
            Import an ePub to get started
          </Text>
          <TouchableOpacity
            style={[styles.emptyAddButton, isDark && styles.darkEmptyAddButton]}
            onPress={pickDocument}
          >
            <Text style={styles.emptyAddButtonText}>Add Book</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <Animated.View style={{ flex: 1, opacity: fadeAnim }}>
          <FlatList
            data={filteredBooks}
            keyExtractor={(item) => item.id}
            numColumns={2}
            contentContainerStyle={[
              styles.bookGrid,
              isDark && { paddingBottom: 20 },
            ]}
            ListEmptyComponent={
              searchQuery ? (
                <View style={styles.noResultsContainer}>
                  <Ionicons
                    name="search-outline"
                    size={50}
                    color={isDark ? "#4B5563" : "#CCCCCC"}
                  />
                  <Text
                    style={[styles.noResultsText, isDark && styles.darkSubText]}
                  >
                    No books match your search
                  </Text>
                </View>
              ) : null
            }
            renderItem={({ item, index }) => (
              <Animated.View
                style={{
                  opacity: fadeAnim,
                  transform: [
                    {
                      translateY: fadeAnim.interpolate({
                        inputRange: [0, 1],
                        outputRange: [50, 0],
                      }),
                    },
                  ],
                }}
              >
                <TouchableOpacity
                  style={[styles.bookCard, isDark && styles.darkBookCard]}
                  onPress={() => openBook(item)}
                  activeOpacity={0.7}
                  delayPressIn={50}
                >
                  <View style={styles.coverContainer}>
                    {item.coverUrl ? (
                      <Image
                        source={{ uri: item.coverUrl }}
                        style={styles.coverImage}
                        resizeMode="cover"
                      />
                    ) : (
                      <View
                        style={[
                          styles.placeholderCover,
                          isDark && styles.darkPlaceholderCover,
                        ]}
                      >
                        <Ionicons
                          name="book"
                          size={40}
                          color={isDark ? "#4B5563" : "#CCCCCC"}
                        />
                      </View>
                    )}
                    {item.progress > 0 && (
                      <View style={styles.progressBarContainer}>
                        <View style={styles.progressBar}>
                          <View
                            style={[
                              styles.progressFill,
                              { width: `${item.progress * 100}%` },
                              isDark && { backgroundColor: "#60A5FA" },
                            ]}
                          />
                        </View>
                        <Text style={styles.progressText}>
                          {Math.round(item.progress * 100)}%
                        </Text>
                      </View>
                    )}
                  </View>
                  <View style={styles.bookInfo}>
                    <Text
                      style={[styles.bookTitle, isDark && styles.darkText]}
                      numberOfLines={2}
                    >
                      {item.title}
                    </Text>
                    <Text
                      style={[styles.bookDate, isDark && styles.darkSubText]}
                    >
                      {formatDate(item.lastOpenedAt)}
                    </Text>
                  </View>
                  <TouchableOpacity
                    onPress={() => removeBook(item.id)}
                    style={styles.removeButton}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  >
                    <Ionicons name="close-circle" size={22} color="#FF3B30" />
                  </TouchableOpacity>
                </TouchableOpacity>
              </Animated.View>
            )}
          />
        </Animated.View>
      )}
      <StatusBar style={isDark ? "light" : "dark"} />
    </SafeAreaView>
  );
};

// Reader Screen for displaying ePub content
const ReaderScreen = ({ route, navigation }) => {
  const { book } = route.params;
  const { theme } = useContext(ThemeContext);
  const isDark = theme === "dark";

  const [loading, setLoading] = useState(true);
  const [chapters, setChapters] = useState([]);
  const [chapterTitles, setChapterTitles] = useState([]);
  const [currentChapter, setCurrentChapter] = useState(
    book.currentChapter || 0,
  );
  const [currentPage, setCurrentPage] = useState(book.currentPage || 0);
  const [totalPages, setTotalPages] = useState(book.totalPages || 1);
  const [pagesLeftInChapter, setPagesLeftInChapter] = useState(0);
  const [showToc, setShowToc] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showQuickMenu, setShowQuickMenu] = useState(false);
  const [showTldrMenu, setShowTldrMenu] = useState(false);
  const [fontSize, setFontSize] = useState(100);
  const [readerTheme, setReaderTheme] = useState("light");
  const [isPageTurning, setIsPageTurning] = useState(false);
  const [currentPageText, setCurrentPageText] = useState("");
  const [aiSummary, setAiSummary] = useState("");
  const [isGeneratingSummary, setIsGeneratingSummary] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [audioProgress, setAudioProgress] = useState(0);
  const [audioFile, setAudioFile] = useState(null);
  const [sound, setSound] = useState(null);
  const [ollamaUrl, setOllamaUrl] = useState("http://100.116.78.42:11434");
  const [summaryCache, setSummaryCache] = useState({});
  const [showManualSummaryModal, setShowManualSummaryModal] = useState(false);
  const [manualSummaryText, setManualSummaryText] = useState("");
  const [pageTransitionEffect, setPageTransitionEffect] = useState("slide");
  const [readingStartTime, setReadingStartTime] = useState(null);
  const readingTimer = useRef(null);

  // Start reading timer when component mounts
  useEffect(() => {
    setReadingStartTime(Date.now());
    readingTimer.current = setInterval(updateReadingStats, 60000); // Update every minute

    return () => {
      if (readingTimer.current) {
        clearInterval(readingTimer.current);
      }
      updateReadingStats(true); // Final update when unmounting
    };
  }, []);

  const updateReadingStats = async (isFinal = false) => {
    if (!readingStartTime) return;

    const currentTime = Date.now();
    const readingDuration = Math.floor(
      (currentTime - readingStartTime) / 60000,
    ); // Convert to minutes

    if (readingDuration >= 10 || isFinal) {
      try {
        const stats = await AsyncStorage.getItem("readingStats");
        let newStats = {
          totalReadingTime: 0,
          streakDays: 0,
          lastReadDate: null,
        };

        if (stats) {
          newStats = JSON.parse(stats);
        }

        // Update total reading time
        newStats.totalReadingTime += readingDuration;

        // Update streak
        const today = new Date().toDateString();
        const lastRead = newStats.lastReadDate
          ? new Date(newStats.lastReadDate).toDateString()
          : null;

        if (!lastRead || lastRead === today) {
          // Same day, no change to streak
        } else {
          const yesterday = new Date();
          yesterday.setDate(yesterday.getDate() - 1);
          if (lastRead === yesterday.toDateString()) {
            // Consecutive day
            newStats.streakDays += 1;
          } else {
            // Streak broken
            newStats.streakDays = 1;
          }
        }

        newStats.lastReadDate = new Date().toISOString();
        await AsyncStorage.setItem("readingStats", JSON.stringify(newStats));

        if (isFinal) {
          setReadingStartTime(null);
        } else {
          setReadingStartTime(currentTime);
        }
      } catch (error) {
        console.error("Error updating reading stats:", error);
      }
    }
  };

  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [currentSearchResult, setCurrentSearchResult] = useState(-1);
  const [showSearch, setShowSearch] = useState(false);

  const webViewRef = useRef(null);
  const menuSlideAnim = useRef(new Animated.Value(height)).current;
  const audioProgressInterval = useRef(null);
  const pageTransitionAnim = useRef(new Animated.Value(0)).current;

  // Create pan responder for swipe gestures with improved detection
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (evt, gestureState) => {
        return Math.abs(gestureState.dx) > 5 || Math.abs(gestureState.dy) > 5;
      },
      onPanResponderGrant: () => {
        menuSlideAnim.setValue(height);
      },
      onPanResponderMove: (evt, gestureState) => {
        // Handle page transition animation
        if (Math.abs(gestureState.dx) > Math.abs(gestureState.dy) * 1.5) {
          const offset = gestureState.dx;
          pageTransitionAnim.setValue(offset);
        }
      },
      onPanResponderRelease: (evt, gestureState) => {
        // Detect swipe direction
        const isHorizontalSwipe =
          Math.abs(gestureState.dx) > Math.abs(gestureState.dy) * 1.5;
        const isVerticalSwipe =
          Math.abs(gestureState.dy) > Math.abs(gestureState.dx) * 1.5;

        if (isHorizontalSwipe && Math.abs(gestureState.dx) > 40) {
          if (gestureState.dx > 0) {
            // Swipe right - go to previous page
            handlePreviousPage();
          } else {
            // Swipe left - go to next page
            handleNextPage();
          }
        } else if (isVerticalSwipe) {
          if (gestureState.dy < -50) {
            // Swipe up - show quick menu
            showQuickMenuHandler();
          } else if (gestureState.dy > 50) {
            // Swipe down - show TL;DR menu
            showTldrMenuHandler();
          }
        }
      },
    }),
  ).current;

  // Function to show the quick menu
  const showQuickMenuHandler = () => {
    // Trigger haptic feedback
    if (Platform.OS === "ios") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }

    // Extract current page text for audio and AI summary
    extractCurrentPageText();

    setShowQuickMenu(true);
    Animated.spring(menuSlideAnim, {
      toValue: 0,
      useNativeDriver: true,
      tension: 50,
      friction: 7,
    }).start();
  };

  // Function to hide the quick menu
  const hideQuickMenuHandler = () => {
    // Trigger haptic feedback
    if (Platform.OS === "ios") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }

    // Stop audio if playing
    if (isPlaying) {
      handleStopAudio();
    }

    Animated.spring(menuSlideAnim, {
      toValue: height,
      useNativeDriver: true,
      tension: 50,
      friction: 7,
    }).start(() => {
      setShowQuickMenu(false);
    });

    // Reset search when closing menu
    setShowSearch(false);
    setSearchResults([]);
    setCurrentSearchResult(-1);
  };

  // Function to show the TL;DR menu
  const showTldrMenuHandler = () => {
    // Trigger haptic feedback
    if (Platform.OS === "ios") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }

    // Extract current page text and generate summary
    extractCurrentPageText();
    generateAiSummary();

    setShowTldrMenu(true);
    Animated.spring(menuSlideAnim, {
      toValue: 0,
      useNativeDriver: true,
      tension: 50,
      friction: 7,
    }).start();
  };

  // Function to hide the TL;DR menu
  const hideTldrMenuHandler = () => {
    // Trigger haptic feedback
    if (Platform.OS === "ios") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }

    Animated.spring(menuSlideAnim, {
      toValue: height,
      useNativeDriver: true,
      tension: 50,
      friction: 7,
    }).start(() => {
      setShowTldrMenu(false);
    });
  };

  // Extract text from current page
  const extractCurrentPageText = () => {
    // Check if we already have a cached summary for this page
    const cacheKey = `${currentChapter}-${currentPage}`;
    if (summaryCache[cacheKey]) {
      console.log("Using cached summary for", cacheKey);
      setAiSummary(summaryCache[cacheKey]);
      return;
    }

    // Extract the text to have it available
    webViewRef.current?.injectJavaScript(`
      extractCurrentPageText(${currentPage});
      true;
    `);
  };

  // Configure Ollama API URL
  const configureOllamaUrl = () => {
    Alert.prompt(
      "Ollama API URL",
      "Enter the URL of your Ollama API server:",
      [
        {
          text: "Cancel",
          style: "cancel",
        },
        {
          text: "Save",
          onPress: (url) => {
            if (url) {
              setOllamaUrl(url);
              AsyncStorage.setItem("ollamaUrl", url);
            }
          },
        },
      ],
      "plain-text",
      ollamaUrl,
    );
  };

  // Generate AI summary only when TL;DR tab is opened
  const generateAiSummary = async () => {
    if (!currentPageText.trim()) {
      setAiSummary("No text available to summarize.");
      return;
    }

    setIsGeneratingSummary(true);
    try {
      const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // Optional: include an API key if you have one
          // "Authorization": `Bearer ${GROQ_API_KEY}`,
        },
        body: JSON.stringify({
          model: "mixtral-8x7b-32768",
          messages: [
            {
              role: "system",
              content: "You are a helpful assistant that summarizes literature concisely.",
            },
            {
              role: "user",
              content: `Summarize the following extract from *The Satanic Verses* by Salman Rushdie in 1-2 sentences. Only return the summary — no extra commentary. Make it short and sweet:\n\n${currentPageText}`,
            },
          ],
          temperature: 0.5,
          stream: true,
        }),
      });

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let summary = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');
        
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') break;
            
            try {
              const parsed = JSON.parse(data);
              if (parsed.choices[0].delta.content) {
                summary += parsed.choices[0].delta.content;
                setAiSummary(summary);
              }
            } catch (e) {
              console.error('Error parsing stream data:', e);
            }
          }
        }
      }

      // Cache the final summary
      const cacheKey = `${currentChapter}-${currentPage}`;
      setSummaryCache((prev) => ({
        ...prev,
        [cacheKey]: summary,
      }));

    } catch (error) {
      console.error("Error generating summary:", error);
      setAiSummary("Failed to generate summary. Please try again.");
    } finally {
      setIsGeneratingSummary(false);
    }
  };

  // New function to handle manual summary upload
  const showManualSummaryUpload = () => {
    // Pre-fill with existing summary if available
    if (aiSummary) {
      setManualSummaryText(aiSummary);
    } else {
      setManualSummaryText("");
    }
    setShowManualSummaryModal(true);
  };

  // Save manually entered summary
  const saveManualSummary = () => {
    if (manualSummaryText.trim() === "") {
      Alert.alert("Error", "Please enter a summary before saving.");
      return;
    }

    // Cache the manual summary
    const cacheKey = `${currentChapter}-${currentPage}`;
    const newCache = { ...summaryCache };
    newCache[cacheKey] = manualSummaryText.trim();
    setSummaryCache(newCache);

    // Update the current summary
    setAiSummary(manualSummaryText.trim());
    setShowManualSummaryModal(false);

    // Trigger haptic feedback for success
    if (Platform.OS === "ios") {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
  };

  // Pick audio file from device
  const pickAudioFile = async () => {
    try {
      // Trigger haptic feedback
      if (Platform.OS === "ios") {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }

      const result = await DocumentPicker.getDocumentAsync({
        type: "audio/*",
        copyToCacheDirectory: true,
      });

      if (result.canceled) {
        return;
      }

      const { uri, name } = result.assets[0];
      setAudioFile({ uri, name });

      // Stop any currently playing audio
      if (sound) {
        await sound.unloadAsync();
      }

      // Create a new sound object
      const { sound: newSound } = await Audio.Sound.createAsync(
        { uri },
        { shouldPlay: false },
      );

      setSound(newSound);

      // Get duration for progress tracking
      const status = await newSound.getStatusAsync();
      if (status.isLoaded) {
        console.log(`Audio duration: ${status.durationMillis}ms`);
      }
    } catch (error) {
      console.error("Error picking audio file:", error);
    }
  };

  // Audio player functions
  const handlePlayPause = async () => {
    try {
      // Trigger haptic feedback
      if (Platform.OS === "ios") {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }

      if (!sound && audioFile) {
        // If sound was unloaded but we have an audio file, reload it
        const { sound: newSound } = await Audio.Sound.createAsync(
          { uri: audioFile.uri },
          { shouldPlay: false },
        );
        setSound(newSound);
        await newSound.playAsync();
      } else if (sound) {
        // Play existing sound
        await sound.playAsync();
      } else {
        // No audio file selected yet
        pickAudioFile();
        return;
      }

      setIsPlaying(!isPlaying);

      // Start progress tracking
      audioProgressInterval.current = setInterval(async () => {
        if (sound) {
          const status = await sound.getStatusAsync();
          if (status.isLoaded) {
            const progress =
              (status.positionMillis / status.durationMillis) * 100;
            setAudioProgress(progress);

            // Check if playback has finished
            if (status.didJustFinish) {
              clearInterval(audioProgressInterval.current);
              setIsPlaying(false);
              setAudioProgress(0);
            }
          }
        }
      }, 100);
    } catch (error) {
      console.error("Error playing audio:", error);
    }
  };

  const handlePauseAudio = async () => {
    // Trigger haptic feedback
    if (Platform.OS === "ios") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }

    if (sound) {
      await sound.pauseAsync();
      setIsPlaying(false);
      clearInterval(audioProgressInterval.current);
    }
  };

  const handleStopAudio = async () => {
    // Trigger haptic feedback
    if (Platform.OS === "ios") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }

    if (sound) {
      await sound.stopAsync();
      await sound.setPositionAsync(0);
      setIsPlaying(false);
      setAudioProgress(0);
      clearInterval(audioProgressInterval.current);
    }
  };

  // Add this function to handle search in the ReaderScreen component, before the return statement
  const handleSearch = () => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      return;
    }

    // Send search query to WebView
    webViewRef.current?.injectJavaScript(`
      searchText(${JSON.stringify(searchQuery)});
      true;
    `);
  };

  // Add this function to navigate between search results
  const navigateToSearchResult = (index) => {
    if (index >= 0 && index < searchResults.length) {
      setCurrentSearchResult(index);

      // Navigate to the page containing this result
      const result = searchResults[index];

      // If we're not already on the right page, go to it
      if (currentPage !== result.page) {
        setCurrentPage(result.page);

        // Use the improved page turning function with animation
        webViewRef.current?.injectJavaScript(`
          goToPage(${result.page}, 'next');

          // Highlight the result after page change
          setTimeout(() => {
            highlightSearchResult(${index});
          }, 500);

          true;
        `);
      } else {
        // If we're already on the right page, just highlight
        webViewRef.current?.injectJavaScript(`
          highlightSearchResult(${index});
          true;
        `);
      }

      // Trigger haptic feedback
      if (Platform.OS === "ios") {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }
    }
  };

  // Add this function to go to the next search result
  const nextSearchResult = () => {
    if (searchResults.length > 0) {
      const nextIndex = (currentSearchResult + 1) % searchResults.length;
      navigateToSearchResult(nextIndex);
    }
  };

  // Add this function to go to the previous search result
  const previousSearchResult = () => {
    if (searchResults.length > 0) {
      const prevIndex =
        currentSearchResult <= 0
          ? searchResults.length - 1
          : currentSearchResult - 1;
      navigateToSearchResult(prevIndex);
    }
  };

  // Add this function to toggle the search UI
  const toggleSearch = () => {
    setShowSearch(!showSearch);
    if (!showSearch) {
      // When opening search, focus on input
      setTimeout(() => {
        // Clear previous results when opening search again
        setSearchResults([]);
        setCurrentSearchResult(-1);
      }, 100);
    }
  };

  // Add tap zone handlers for alternative page turning
  const handleLeftTap = () => {
    // Left side tap - go to previous page
    handlePreviousPage();
  };

  const handleRightTap = () => {
    // Right side tap - go to next page
    handleNextPage();
  };

  // Change page transition effect
  const changePageTransitionEffect = (effect) => {
    setPageTransitionEffect(effect);
    webViewRef.current?.injectJavaScript(`
      setPageTransitionEffect('${effect}');
      true;
    `);

    // Trigger haptic feedback
    if (Platform.OS === "ios") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
  };

  // Improved page turning functions with enhanced animations
  const handleNextPage = () => {
    if (currentPage < totalPages - 1) {
      // Trigger haptic feedback
      if (Platform.OS === "ios") {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }

      const newPage = currentPage + 1;
      setCurrentPage(newPage);
      setPagesLeftInChapter(totalPages - newPage - 1);

      // Update WebView content immediately
      webViewRef.current?.injectJavaScript(`
        if (typeof goToPage === 'function') {
          goToPage(${newPage}, 'next');
        } else {
          console.error('goToPage function not found');
        }
        true;
      `);

      // Save progress
      saveProgress(currentChapter, newPage, totalPages);
    } else if (currentChapter < chapters.length - 1) {
      // Go to next chapter
      const newChapter = currentChapter + 1;
      setCurrentChapter(newChapter);
      setCurrentPage(0);
      setPagesLeftInChapter(totalPages - 1);

      // Update WebView content immediately
      webViewRef.current?.injectJavaScript(`
        if (typeof prepareChapterTransition === 'function') {
          prepareChapterTransition('next');
        } else {
          console.error('prepareChapterTransition function not found');
        }
        true;
      `);

      // Save progress
      saveProgress(newChapter, 0, totalPages);
    }
  };

  const handlePreviousPage = () => {
    if (currentPage > 0) {
      // Trigger haptic feedback
      if (Platform.OS === "ios") {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }

      const newPage = currentPage - 1;
      setCurrentPage(newPage);
      setPagesLeftInChapter(totalPages - newPage - 1);

      // Update WebView content with a small delay
      setTimeout(() => {
        webViewRef.current?.injectJavaScript(`
          if (typeof goToPage === 'function') {
            goToPage(${newPage}, 'prev');
          } else {
            console.error('goToPage function not found');
          }
          true;
        `);
      }, 50);

      // Save progress
      saveProgress(currentChapter, newPage, totalPages);
    } else if (currentChapter > 0) {
      // Go to previous chapter
      const newChapter = currentChapter - 1;
      setCurrentChapter(newChapter);
      setCurrentPage(0);
      setPagesLeftInChapter(totalPages - 1);

      // Update WebView content with a small delay
      setTimeout(() => {
        webViewRef.current?.injectJavaScript(`
          if (typeof prepareChapterTransition === 'function') {
            prepareChapterTransition('prev');
          } else {
            console.error('prepareChapterTransition function not found');
          }
          true;
        `);
      }, 50);

      // Save progress
      saveProgress(newChapter, 0, totalPages);
    }
  };

  // Extract and parse ePub content
  useEffect(() => {
    const extractEpubContent = async () => {
      try {
        setLoading(true);

        // Load summary cache from AsyncStorage
        try {
          const cachedSummaries = await AsyncStorage.getItem(
            `summaryCache-${book.id}`,
          );
          if (cachedSummaries) {
            setSummaryCache(JSON.parse(cachedSummaries));
          }
        } catch (error) {
          console.error("Error loading summary cache:", error);
        }

        // Read the ePub file
        const epubData = await FileSystem.readAsStringAsync(book.uri, {
          encoding: FileSystem.EncodingType.Base64,
        });

        // Create a new JSZip instance
        const zip = new JSZip();
        // Load the ePub data
        const contents = await zip.loadAsync(epubData, { base64: true });

        // First look for container.xml to find the OPF file
        const containerFile = contents.file("META-INF/container.xml");
        if (!containerFile) {
          throw new Error("container.xml not found");
        }

        const containerXml = await containerFile.async("text");

        // Parse container.xml to find the OPF file path
        let opfPath = "";
        parseString(containerXml, (err, result) => {
          if (err) throw err;
          opfPath = result.container.rootfiles[0].rootfile[0].$["full-path"];
        });

        // Read the OPF file
        const opfFile = contents.file(opfPath);
        if (!opfFile) {
          throw new Error("OPF file not found");
        }

        const opfContent = await opfFile.async("text");

        // Parse OPF to find spine and manifest
        let chapterItems = [];
        let titles = [];
        parseString(opfContent, (err, result) => {
          if (err) throw err;

          const manifest = result.package.manifest[0].item;
          const spine = result.package.spine[0].itemref;

          // Try to get chapter titles from the table of contents
          try {
            if (result.package.guide && result.package.guide[0].reference) {
              const tocRef = result.package.guide[0].reference.find(
                (ref) => ref.$["type"] === "toc",
              );

              if (tocRef) {
                const tocPath = tocRef.$["href"];
                const fullTocPath =
                  opfPath.substring(0, opfPath.lastIndexOf("/")) +
                  "/" +
                  tocPath;

                // We'll extract titles later from the TOC file
                titles = Array(spine.length)
                  .fill("")
                  .map((_, i) => `Chapter ${i + 1}`);
              }
            }
          } catch (e) {
            console.warn("Could not extract TOC:", e);
          }

          // Map spine items to their content files
          chapterItems = spine
            .map((item, index) => {
              const idRef = item.$["idref"];
              const manifestItem = manifest.find((m) => m.$["id"] === idRef);
              return {
                href: manifestItem ? manifestItem.$["href"] : null,
                title: titles[index] || `Chapter ${index + 1}`,
              };
            })
            .filter((item) => item.href);
        });

        // Resolve paths relative to OPF file
        const opfDir = opfPath.substring(0, opfPath.lastIndexOf("/"));

        // Extract each chapter content
        const extractedChapters = await Promise.all(
          chapterItems.map(async (item, index) => {
            const fullPath = opfDir ? `${opfDir}/${item.href}` : item.href;
            const chapterFile = contents.file(fullPath);
            if (!chapterFile) {
              console.warn(`Chapter file not found: ${fullPath}`);
              return "<p>Chapter content not available</p>";
            }

            const content = await chapterFile.async("text");

            // Try to extract chapter title from content
            let title = item.title;
            try {
              const titleMatch =
                content.match(/<h1[^>]*>(.*?)<\/h1>/i) ||
                content.match(/<h2[^>]*>(.*?)<\/h2>/i) ||
                content.match(/<title[^>]*>(.*?)<\/title>/i);

              if (titleMatch && titleMatch[1]) {
                // Clean up the title (remove HTML tags)
                title = titleMatch[1].replace(/<[^>]*>/g, "").trim();
                if (!title) title = `Chapter ${index + 1}`;
              }
            } catch (e) {
              console.warn("Error extracting chapter title:", e);
            }

            // Process content to make it work in WebView
            let processedContent = content;

            // Extract images and save them locally
            const imgRegex = /<img[^>]+src="([^">]+)"/g;
            let match;
            while ((match = imgRegex.exec(content)) !== null) {
              const imgPath = match[1];
              if (!imgPath.startsWith("http")) {
                // Resolve relative path
                const imgFullPath = imgPath.startsWith("/")
                  ? imgPath.substring(1)
                  : opfDir
                    ? `${opfDir}/${imgPath}`
                    : imgPath;

                try {
                  // Extract image
                  const imgFile = contents.file(imgFullPath);
                  if (imgFile) {
                    const imgData = await imgFile.async("base64");
                    // Replace with data URL
                    const imgType = imgPath.endsWith(".png")
                      ? "png"
                      : imgPath.endsWith(".jpg") || imgPath.endsWith(".jpeg")
                        ? "jpeg"
                        : "png";
                    const dataUrl = `data:image/${imgType};base64,${imgData}`;
                    processedContent = processedContent.replace(
                      imgPath,
                      dataUrl,
                    );
                  }
                } catch (e) {
                  console.error(`Error processing image ${imgPath}:`, e);
                }
              }
            }

            return { content: processedContent, title };
          }),
        );

        setChapters(extractedChapters.map((ch) => ch.content));
        setChapterTitles(extractedChapters.map((ch) => ch.title));
        setLoading(false);
      } catch (error) {
        console.error("Error extracting ePub content:", error);
        setLoading(false);
      }
    };

    const setupAudio = async () => {
      try {
        // Initialize audio session
        await Audio.setAudioModeAsync({
          allowsRecordingIOS: false,
          staysActiveInBackground: true,
          playsInSilentModeIOS: true,
          shouldDuckAndroid: true,
          playThroughEarpieceAndroid: false,
        });
      } catch (error) {
        console.error("Error setting up audio:", error);
      }
    };

    extractEpubContent();
    setupAudio();
  }, []);

  // Clean up audio when component unmounts
  // Add code to persist the summary cache to AsyncStorage when the component unmounts
  // Add this inside the useEffect that handles cleanup
  useEffect(() => {
    return () => {
      // Save the summary cache to AsyncStorage
      const saveSummaryCache = async () => {
        try {
          await AsyncStorage.setItem(
            `summaryCache-${book.id}`,
            JSON.stringify(summaryCache),
          );
        } catch (error) {
          console.error("Error saving summary cache:", error);
        }
      };

      saveSummaryCache();

      if (audioProgressInterval.current) {
        clearInterval(audioProgressInterval.current);
      }
      if (sound) {
        sound.unloadAsync();
      }
    };
  }, [sound, summaryCache, book.id]);

  // Save reading progress
  const saveProgress = async (chapter, page, totalPages) => {
    try {
      const storedBooks = await AsyncStorage.getItem("books");
      if (storedBooks) {
        const books = JSON.parse(storedBooks);
        const progress =
          (chapter / (chapters.length - 1)) * 0.9 + (page / totalPages) * 0.1;
        const updatedBooks = books.map((b) =>
          b.id === book.id
            ? {
                ...b,
                progress,
                currentChapter: chapter,
                currentPage: page,
                totalPages,
              }
            : b,
        );
        await AsyncStorage.setItem("books", JSON.stringify(updatedBooks));
      }
    } catch (error) {
      console.error("Error saving progress:", error);
    }
  };

  const handleChapterChange = (index) => {
    // Trigger haptic feedback
    if (Platform.OS === "ios") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }

    setCurrentChapter(index);
    setCurrentPage(0);
    setShowToc(false);
    saveProgress(index, 0, totalPages);
  };

  const handleFontSizeChange = (size) => {
    // Trigger haptic feedback
    if (Platform.OS === "ios") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }

    setFontSize(size);
    webViewRef.current?.injectJavaScript(`
      document.body.style.fontSize = '${size}%';
      paginateContent();
      true;
    `);
  };

  const handleThemeChange = (newTheme) => {
    // Trigger haptic feedback
    if (Platform.OS === "ios") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }

    setReaderTheme(newTheme);
    webViewRef.current?.injectJavaScript(`
      document.body.className = '${newTheme}-theme';
      true;
    `);
  };

  const handleMessage = (event) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      if (data.type === "pageCount") {
        // Update total pages and ensure current page is within bounds
        const newTotalPages = data.pages;

        // Ensure current page is within bounds
        const boundedPage = Math.min(currentPage, newTotalPages - 1);
        if (currentPage !== boundedPage) {
          setCurrentPage(boundedPage);
        }

        setPagesLeftInChapter(newTotalPages - boundedPage - 1);
        saveProgress(currentChapter, boundedPage, newTotalPages);
      }
      // Add this to the handleMessage function inside the ReaderScreen component to handle search results
      else if (data.type === "searchResults") {
        setSearchResults(data.results);
        setCurrentSearchResult(-1); // Reset current result

        if (data.results.length > 0) {
          // If we have results, highlight the first one
          navigateToSearchResult(0);
        } else {
          // If no results, show alert
          Alert.alert("No Results", `No matches found for "${searchQuery}"`);
        }
      } else if (data.type === "pageChanged") {
        // Confirm page change was successful but don't update state here
        // This prevents double page turning when the WebView reports back
        console.log("Page changed to:", data.page, "Success:", data.success);
      } else if (data.type === "pageText") {
        // Handle extracted page text
        setCurrentPageText(data.text);
      }
    } catch (error) {
      console.error("Error parsing WebView message:", error);
    }
  };

  if (loading) {
    return (
      <View style={styles.centeredContainer}>
        <ActivityIndicator size="large" color="#007AFF" />
      </View>
    );
  }

  if (chapters.length === 0) {
    return (
      <View style={styles.centeredContainer}>
        <Text style={styles.errorText}>
          Could not extract content from this ePub file.
        </Text>
      </View>
    );
  }

  // Create HTML with reader UI and pagination
  const readerHtml = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
      <style>
        html, body {
          margin: 0;
          padding: 0;
          width: 100%;
          height: 100%;
          overflow: hidden;
          -webkit-overflow-scrolling: none;
          overscroll-behavior: none;
        }
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Helvetica Neue', sans-serif;
          line-height: 1.5;
          font-size: ${fontSize}%;
          transition: all 0.1s ease;
          padding: 0;
          -webkit-user-select: none;
          user-select: none;
          touch-action: none;
        }
        .light-theme {
          color: #1C1C1E;
          background-color: #FFFFFF;
        }
        .dark-theme {
          color: #E5E5EA;
          background-color: #000000;
        }
        .sepia-theme {
          color: #3C3C3C;
          background-color: #F4ECD8;
        }
        #book-container {
          display: flex;
          flex-direction: column;
          height: 100vh;
          width: 100vw;
          overflow: hidden;
          position: relative;
        }
        #chapter-title {
          text-align: center;
          font-size: 1.2em;
          font-weight: 600;
          margin: 1em 0;
          padding: 0 20px;
          color: #8E8E93;
        }
        #chapter-divider {
          text-align: center;
          margin: 0.5em 0 1.5em;
          font-size: 1em;
          color: #8E8E93;
        }
        #book-content-wrapper {
          position: relative;
          height: calc(100vh - 120px);
          width: 100%;
          overflow: hidden;
          position: relative;
        }
        #book-content {
          position: absolute;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          display: flex;
          flex-direction: row;
          transition: none;
        }
        .page {
          width: 100%;
          height: 100%;
          flex: 0 0 100%;
          padding: 20px;
          box-sizing: border-box;
          overflow: hidden;
          opacity: 1;
          transition: none;
          word-wrap: break-word;
          overflow-wrap: break-word;
          hyphens: auto;
          line-height: 1.6;
          text-align: justify;
        }
        .page::after {
          content: '';
          position: absolute;
          bottom: 0;
          left: 0;
          right: 0;
          height: 40px;
          background: linear-gradient(to bottom, transparent, var(--page-bg));
        }
        .light-theme .page::after {
          --page-bg: #FFFFFF;
        }
        .dark-theme .page::after {
          --page-bg: #000000;
        }
        .sepia-theme .page::after {
          --page-bg: #F4ECD8;
        }
        .search-highlight {
          background-color: #FFFF00;
          color: #000000;
        }
        .dark-theme .search-highlight {
          background-color: #4A4A4A;
          color: #E5E5EA;
        }
        .page-entering-next {
          animation: enterFromRight 0.3s ease-out;
        }
        .page-entering-prev {
          animation: enterFromLeft 0.3s ease-out;
        }
        .page-exiting-next {
          animation: exitToLeft 0.3s ease-out;
        }
        .page-exiting-prev {
          animation: exitToRight 0.3s ease-out;
        }
        @keyframes enterFromRight {
          from { transform: translateX(100%); }
          to { transform: translateX(0); }
        }
        @keyframes enterFromLeft {
          from { transform: translateX(-100%); }
          to { transform: translateX(0); }
        }
        @keyframes exitToLeft {
          from { transform: translateX(0); }
          to { transform: translateX(-100%); }
        }
        @keyframes exitToRight {
          from { transform: translateX(0); }
          to { transform: translateX(100%); }
        }
        .chapter-transition {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background-color: rgba(0, 0, 0, 0.5);
          display: flex;
          align-items: center;
          justify-content: center;
          opacity: 0;
          transition: opacity 0.3s ease;
          pointer-events: none;
        }
        .chapter-transition.active {
          opacity: 1;
        }
        #chapter-transition-title {
          color: white;
          font-size: 1.5em;
          font-weight: 600;
        }
        img {
          max-width: 100%;
          height: auto;
          border-radius: 8px;
        }
        h1, h2, h3, h4, h5, h6 {
          line-height: 1.3;
          font-weight: 600;
          margin-top: 1.5em;
          margin-bottom: 0.5em;
        }
        p {
          margin-bottom: 1em;
          text-align: justify;
          letter-spacing: -0.01em;
          word-wrap: break-word;
          overflow-wrap: break-word;
          hyphens: auto;
          line-height: 1.6;
        }
        #page-footer {
          position: fixed;
          bottom: 10px;
          width: 100%;
          text-align: center;
          font-size: 0.8em;
          color: #8E8E93;
          z-index: 10;
        }
      </style>
    </head>
    <body class="${readerTheme}-theme">
      <div id="book-container">
        <div id="chapter-title">${chapterTitles[currentChapter]}</div>
        <div id="chapter-divider">• • •</div>
        <div id="book-content-wrapper">
          <div id="book-content" class="transition-${pageTransitionEffect}">
            <!-- Pages will be created dynamically -->
          </div>
        </div>
        <div id="page-footer">
          <span id="page-number"></span>
        </div>
      </div>
      <div class="chapter-transition">
        <div class="chapter-transition-content">
          <h2 id="chapter-transition-title"></h2>
        </div>
      </div>
      <script>
  // Current transition effect
  let currentTransitionEffect = '${pageTransitionEffect}';
  let searchResultElements = [];

  // Set page transition effect
  function setPageTransitionEffect(effect) {
    currentTransitionEffect = effect;
    const content = document.getElementById('book-content');
    content.className = 'transition-' + effect;
  }

  // Parse and paginate the content - FIXED VERSION
  function paginateContent() {
    const contentWrapper = document.getElementById('book-content-wrapper');
    const content = document.getElementById('book-content');

    // Clear existing content
    content.innerHTML = '';

    // Get the raw HTML content
    const rawContent = \`${chapters[currentChapter]}\`;

    // Create a temporary container to measure content
    const tempContainer = document.createElement('div');
    tempContainer.style.width = contentWrapper.offsetWidth + 'px';
    tempContainer.style.position = 'absolute';
    tempContainer.style.visibility = 'hidden';
    tempContainer.style.padding = '0 20px';
    tempContainer.style.boxSizing = 'border-box';
    tempContainer.style.fontFamily = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
    tempContainer.style.fontSize = '${fontSize}%';
    tempContainer.style.lineHeight = '1.6';
    document.body.appendChild(tempContainer);

    // Parse the HTML content
    const parser = new DOMParser();
    const doc = parser.parseFromString(rawContent, 'text/html');

    // Get all elements from the parsed document
    let elements = Array.from(doc.body.children);

    // If no elements (plain text), wrap in paragraph
    if (elements.length === 0 && doc.body.textContent.trim()) {
      const p = document.createElement('p');
      p.textContent = doc.body.textContent.trim();
      elements = [p];
    }

    // For flattened EPUBs, ensure proper structure
    if (elements.length === 1 && elements[0].tagName === 'BODY') {
      elements = Array.from(elements[0].children);
    }

    // Create pages
    let currentPage = document.createElement('div');
    currentPage.className = 'page';
    content.appendChild(currentPage);

    let pageHeight = contentWrapper.offsetHeight - 40; // Subtract padding
    let currentHeight = 0;

    // Process each element
    for (let i = 0; i < elements.length; i++) {
      const element = elements[i];

      // Clone the element to measure it
      const clonedElement = element.cloneNode(true);
      tempContainer.appendChild(clonedElement);
      const elementHeight = clonedElement.offsetHeight;
      tempContainer.removeChild(clonedElement);

      // Special handling for large elements (like images or tables)
      if (elementHeight > pageHeight * 0.9) {
        // If current page already has content, move to next page
        if (currentHeight > 0) {
          currentPage = document.createElement('div');
          currentPage.className = 'page';
          content.appendChild(currentPage);
          currentHeight = 0;
        }

        // Add the large element to its own page
        currentPage.appendChild(element.cloneNode(true));

        // Create a new page for subsequent content
        currentPage = document.createElement('div');
        currentPage.className = 'page';
        content.appendChild(currentPage);
        currentHeight = 0;
        continue;
      }

      // Check if element fits in current page
      if (currentHeight + elementHeight > pageHeight) {
        // If it's a paragraph and too big, try to split it
        if (element.tagName === 'P' || element.tagName === 'DIV') {
          const splitResult = splitParagraph(element, pageHeight - currentHeight, tempContainer);

          // Add first part to current page
          if (splitResult.firstPart) {
            currentPage.appendChild(splitResult.firstPart);
          }

          // Create a new page for the rest
          currentPage = document.createElement('div');
          currentPage.className = 'page';
          content.appendChild(currentPage);
          currentHeight = 0;

          // Add second part to new page
          if (splitResult.secondPart) {
            // Measure the second part
            tempContainer.appendChild(splitResult.secondPart);
            const secondPartHeight = splitResult.secondPart.offsetHeight;
            tempContainer.removeChild(splitResult.secondPart);

            // If it fits, add it
            if (secondPartHeight <= pageHeight) {
              currentPage.appendChild(splitResult.secondPart);
              currentHeight = secondPartHeight;
            } else {
              // If still too big, recursively process it
              i--; // Process this element again
              elements[i] = splitResult.secondPart;
            }
          }
        } else {
          // Create a new page for non-paragraph elements
          currentPage = document.createElement('div');
          currentPage.className = 'page';
          content.appendChild(currentPage);
          currentHeight = 0;

          // Add element to new page
          currentPage.appendChild(element.cloneNode(true));
          currentHeight += elementHeight;
        }
      } else {
        // Element fits, add it to current page
        currentPage.appendChild(element.cloneNode(true));
        currentHeight += elementHeight;
      }
    }

    // Clean up
    document.body.removeChild(tempContainer);

    // Set total pages
    const totalPages = content.children.length;

    // Update page number
    updatePageNumber(${currentPage + 1}, totalPages);

    // Send page count to React Native
    window.ReactNativeWebView.postMessage(JSON.stringify({
      type: 'pageCount',
      pages: totalPages
    }));

    // Preload adjacent pages
    const preloadPages = () => {
      const currentPageIndex = Math.round(Math.abs(parseFloat(content.style.transform.replace('translateX(', '').replace('%)', '')) || 0) / 100);
      const pages = content.children;

      // Preload next 2 pages
      for (let i = 1; i <= 2; i++) {
        if (currentPageIndex + i < pages.length) {
          const nextPage = pages[currentPageIndex + i];
          if (nextPage) {
            nextPage.style.visibility = 'visible';
            nextPage.style.opacity = '1';
          }
        }
      }

      // Preload previous 2 pages
      for (let i = 1; i <= 2; i++) {
        if (currentPageIndex - i >= 0) {
          const prevPage = pages[currentPageIndex - i];
          if (prevPage) {
            prevPage.style.visibility = 'visible';
            prevPage.style.opacity = '1';
          }
        }
      }
    };

    // Go to current page immediately and preload
    goToPage(${currentPage}, null);
    preloadPages();

    // Add preload on page change
    const originalGoToPage = goToPage;
    goToPage = function(pageIndex, direction) {
      originalGoToPage(pageIndex, direction);
      setTimeout(preloadPages, 100); // Preload after page transition
    };
  }

  // Helper function to split a paragraph across pages
  function splitParagraph(paragraph, availableHeight, tempContainer) {
    const originalText = paragraph.textContent;
    const words = originalText.split(' ');

    // Create two new paragraph elements
    const firstPart = document.createElement('p');
    const secondPart = document.createElement('p');

    // Copy attributes from original paragraph
    Array.from(paragraph.attributes).forEach(attr => {
      firstPart.setAttribute(attr.name, attr.value);
      secondPart.setAttribute(attr.name, attr.value);
    });

    // Binary search to find optimal split point
    let low = 1;
    let high = words.length - 1;
    let bestSplit = Math.floor(words.length / 2);

    while (low <= high) {
      const mid = Math.floor((low + high) / 2);

      // Try with this many words in first part
      firstPart.textContent = words.slice(0, mid).join(' ');
      tempContainer.appendChild(firstPart);
      const height = firstPart.offsetHeight;
      tempContainer.removeChild(firstPart);

      if (height <= availableHeight) {
        bestSplit = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }

    // Set content based on best split point
    firstPart.textContent = words.slice(0, bestSplit).join(' ');
    secondPart.textContent = words.slice(bestSplit).join(' ');

    return { firstPart, secondPart };
  }

  // Function to update page number display
  function updatePageNumber(current, total) {
    const pageNumber = document.getElementById('page-number');
    if (pageNumber) {
      pageNumber.textContent = current + ' of ' + total;
    }
  }

  // Improved function to go to a specific page with animation
  function goToPage(pageIndex, direction) {
    const content = document.getElementById('book-content');
    if (!content) return;

    // Get total pages
    const totalPages = content.children.length;

    // Ensure page index is within bounds
    pageIndex = Math.max(0, Math.min(pageIndex, totalPages - 1));

    // Get all pages
    const pages = Array.from(content.children);

    // Store the current visible page for transitions
    const currentVisiblePage = Math.round(Math.abs(parseFloat(content.style.transform.replace('translateX(', '').replace('%)', '')) || 0) / 100);

    // If direction is specified, add transition classes
    if (direction) {
      // Remove any existing transition classes
      pages.forEach(page => {
        page.classList.remove('page-entering-next', 'page-entering-prev', 'page-exiting-next', 'page-exiting-prev');
      });

      if (direction === 'next') {
        // Current page is exiting to the left
        if (pages[currentVisiblePage]) {
          pages[currentVisiblePage].classList.add('page-exiting-next');
        }
        // New page is entering from the right
        if (pages[pageIndex]) {
          pages[pageIndex].classList.add('page-entering-next');
        }
      } else if (direction === 'prev') {
        // Current page is exiting to the right
        if (pages[currentVisiblePage]) {
          pages[currentVisiblePage].classList.add('page-exiting-prev');
        }
        // New page is entering from the left
        if (pages[pageIndex]) {
          pages[pageIndex].classList.add('page-entering-prev');
        }
      }

      // Remove transition classes after animation completes
      setTimeout(() => {
        pages.forEach(page => {
          page.classList.remove('page-entering-next', 'page-entering-prev', 'page-exiting-next', 'page-exiting-prev');
        });
      }, 300);
    }

    // Use transform for page change with animation
    content.style.transform = 'translateX(-' + (pageIndex * 100) + '%)';
    // Update page number
    updatePageNumber(pageIndex + 1, totalPages);

    // Only send the page change message if this is a user-initiated change
    if (direction) {
      window.ReactNativeWebView.postMessage(JSON.stringify({
        type: 'pageChanged',
        page: pageIndex,
        success: true
      }));
    }
  }

  // Prepare for chapter transition
  function prepareChapterTransition(direction) {
    const transition = document.querySelector('.chapter-transition');
    const title = document.getElementById('chapter-transition-title');

    // Set the title based on direction
    if (direction === 'next') {
      title.textContent = 'Next Chapter';
    } else {
      title.textContent = 'Previous Chapter';
    }

    // Show transition
    transition.classList.add('active');

    // Hide after animation
    setTimeout(() => {
      transition.classList.remove('active');
    }, 800);
  }

  // Extract text from current page
  function extractCurrentPageText(pageIndex) {
    const content = document.getElementById('book-content');
    if (!content || !content.children[pageIndex]) return '';

    const currentPage = content.children[pageIndex];
    const text = currentPage.textContent || '';

    // Send the text back to React Native
    window.ReactNativeWebView.postMessage(JSON.stringify({
      type: 'pageText',
      text: text.trim()
    }));

    return true;
  }

  // Search for text in the current chapter
  function searchText(query) {
    if (!query) return;

    // Clear previous highlights
    clearSearchHighlights();

    const content = document.getElementById('book-content');
    if (!content) return;

    const pages = content.children;
    const results = [];

    // Convert query to lowercase for case-insensitive search
    const queryLower = query.toLowerCase();

    // Search through each page
    for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
      const page = pages[pageIndex];
      const pageText = page.textContent || '';

      // Find all occurrences in this page
      let startIndex = 0;
      let index;

      while ((index = pageText.toLowerCase().indexOf(queryLower, startIndex)) !== -1) {
        // Get some context around the match
        const contextStart = Math.max(0, index - 30);
        const contextEnd = Math.min(pageText.length, index + query.length + 30);
        const context = pageText.substring(contextStart, contextEnd);

        // Add to results
        results.push({
          page: pageIndex,
          index: index,
          context: context,
          length: query.length
        });

        // Move to next potential match
        startIndex = index + query.length;
      }
    }

    // Send results back to React Native
    window.ReactNativeWebView.postMessage(JSON.stringify({
      type: 'searchResults',
      results: results
    }));
  }

  // Highlight a specific search result
  function highlightSearchResult(resultIndex) {
    // Clear previous highlights
    clearSearchHighlights();

    // Get the search results from React Native
    const message = JSON.stringify({
      type: 'getSearchResult',
      index: resultIndex
    });

    // This is a workaround since we can't directly access React state
    // We'll highlight based on the page and position information
    const content = document.getElementById('book-content');
    if (!content) return;

    // Get the current page
    const currentPage = content.children[${currentPage}];
    if (!currentPage) return;

    // Create a temporary span to highlight the text
    const highlightSpan = document.createElement('span');
    highlightSpan.className = 'search-highlight';
    highlightSpan.style.backgroundColor = '#FFFF00';
    highlightSpan.style.color = '#000000';

    // Find all text nodes in the current page
    const textNodes = [];
    findTextNodes(currentPage, textNodes);

    // Get the combined text content
    let fullText = '';
    const nodePositions = [];

    textNodes.forEach(node => {
      nodePositions.push({
        start: fullText.length,
        end: fullText.length + node.nodeValue.length,
        node: node
      });
      fullText += node.nodeValue;
    });

    // Find all matches in the full text
    const queryLower = '${searchQuery}'.toLowerCase();
    const fullTextLower = fullText.toLowerCase();
    let startIndex = 0;
    let index;

    while ((index = fullTextLower.indexOf(queryLower, startIndex)) !== -1) {
      // Find which node(s) contain this match
      for (let i = 0; i < nodePositions.length; i++) {
        const pos = nodePositions[i];

        // If this node contains the start of the match
        if (index >= pos.start && index < pos.end) {
          // Calculate the offset within this node
          const nodeOffset = index - pos.start;
          const matchLength = Math.min(queryLower.length, pos.end - index);

          // Split the text node and insert highlight
          const node = pos.node;
          const beforeText = node.nodeValue.substring(0, nodeOffset);
          const matchText = node.nodeValue.substring(nodeOffset, nodeOffset + matchLength);
          const afterText = node.nodeValue.substring(nodeOffset + matchLength);

          const parentNode = node.parentNode;

          // Create text nodes
          const beforeNode = document.createTextNode(beforeText);
          const matchNode = document.createTextNode(matchText);
          const afterNode = document.createTextNode(afterText);

          // Create highlight span
          const highlight = highlightSpan.cloneNode(false);
          highlight.appendChild(matchNode);

          // Replace the original node
          parentNode.replaceChild(afterNode, node);
          parentNode.insertBefore(highlight, afterNode);
          parentNode.insertBefore(beforeNode, highlight);

          // Add to our list of highlights
          searchResultElements.push(highlight);

          // If the match spans multiple nodes, we need to continue
          if (index + queryLower.length > pos.end) {
            // Calculate how much of the query is left
            const remaining = queryLower.length - matchLength;
            startIndex = pos.end;

            // Continue searching from the next node
            break;
          }
        }
      }

      // Move to next potential match
      startIndex = index + queryLower.length;
    }

    // Scroll the first highlight into view
    if (searchResultElements.length > 0) {
      searchResultElements[0].scrollIntoView({
        behavior: 'smooth',
        block: 'center'
      });
    }
  }

  // Helper function to find all text nodes
  function findTextNodes(element, results) {
    if (element.nodeType === 3) { // Text node
      results.push(element);
    } else {
      for (let i = 0; i < element.childNodes.length; i++) {
        findTextNodes(element.childNodes[i], results);
      }
    }
  }

  // Clear search highlights
  function clearSearchHighlights() {
    searchResultElements.forEach(highlight => {
      const parent = highlight.parentNode;
      if (parent) {
        // Get the text content
        const text = highlight.textContent;
        // Create a text node
        const textNode = document.createTextNode(text);
        // Replace the highlight with the text node
        parent.replaceChild(textNode, highlight);
        // Normalize to merge adjacent text nodes
        parent.normalize();
      }
    });

    // Clear the array
    searchResultElements = [];
  }

  // Handle window resize
  function handleResize() {
    // Re-paginate content when window size changes
    paginateContent();
  }

  // Initialize
  document.addEventListener('DOMContentLoaded', function() {
    paginateContent();

    // Add resize event listener with debounce
    let resizeTimer;
    window.addEventListener('resize', function() {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(handleResize, 250);
    });
  });

  // Disable default touch behavior
  document.addEventListener('touchmove', function(e) {
    e.preventDefault();
  }, { passive: false });

  // Prevent text selection for better touch experience
  document.addEventListener('selectstart', function(e) {
    e.preventDefault();
  });
</script>
    </body>
    </html>
  `;

  return (
    <View style={[styles.readerContainer, isDark && styles.darkContainer]}>
      {/* Status bar area */}
      <View style={[styles.readerStatusBar, isDark && styles.darkStatusBar]}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons
            name="chevron-back"
            size={24}
            color={isDark ? "#FFFFFF" : "#007AFF"}
          />
        </TouchableOpacity>

        <Text style={[styles.bookTitle, isDark && styles.darkText]}>
          {book.title}
        </Text>

        <TouchableOpacity
          style={styles.tocButton}
          onPress={() => setShowToc(true)}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons
            name="list"
            size={24}
            color={isDark ? "#FFFFFF" : "#007AFF"}
          />
        </TouchableOpacity>
      </View>

      {/* Main content with tap zones */}
      <View style={styles.webViewContainer}>
        <WebView
          ref={webViewRef}
          originWhitelist={["*"]}
          source={{ html: readerHtml }}
          style={styles.webView}
          javaScriptEnabled={true}
          onMessage={handleMessage}
          scrollEnabled={false}
          bounces={false}
          overScrollMode="never"
        />

        {/* Invisible tap zones for page turning */}
        <View style={styles.tapZonesContainer} {...panResponder.panHandlers}>
          <TouchableOpacity
            style={styles.leftTapZone}
            activeOpacity={1}
            onPress={handleLeftTap}
          />
          <View style={styles.centerTapZone} />
          <TouchableOpacity
            style={styles.rightTapZone}
            activeOpacity={1}
            onPress={handleRightTap}
          />
        </View>
      </View>

      {/* Page indicator */}
      <View
        style={[
          styles.pageIndicator,
          readerTheme === "dark" && styles.darkPageIndicator,
        ]}
      >
        <Text
          style={[
            styles.pageIndicatorText,
            readerTheme === "dark" && styles.darkText,
          ]}
        >
          {pagesLeftInChapter > 0
            ? `${pagesLeftInChapter} pages left in chapter`
            : "Last page of chapter"}
        </Text>
      </View>

      {/* Quick Menu (appears on swipe up) */}
      {showQuickMenu && (
        <Animated.View
          style={[
            styles.quickMenuContainer,
            readerTheme === "dark" && styles.darkQuickMenu,
            {
              transform: [{ translateY: menuSlideAnim }],
            },
          ]}
        >
          <View style={styles.quickMenuHandle}>
            <View
              style={[
                styles.quickMenuHandleBar,
                readerTheme === "dark" && styles.darkHandleBar,
              ]}
            />
          </View>
          <View style={styles.quickMenuContent}>
            <Text
              style={[
                styles.quickMenuTitle,
                readerTheme === "dark" && styles.darkText,
              ]}
            >
              Quick Menu
            </Text>

            {/* Audio Player */}
            <View
              style={[
                styles.audioPlayerContainer,
                readerTheme === "dark" && styles.darkCardBg,
              ]}
            >
              <Text
                style={[
                  styles.audioPlayerTitle,
                  readerTheme === "dark" && styles.darkText,
                ]}
              >
                Audio Player
              </Text>

              {audioFile ? (
                <Text
                  style={[
                    styles.audioFileName,
                    readerTheme === "dark" && styles.darkSubText,
                  ]}
                >
                  {audioFile.name}
                </Text>
              ) : (
                <Text
                  style={[
                    styles.audioFilePrompt,
                    readerTheme === "dark" && styles.darkSubText,
                  ]}
                >
                  No audio file selected
                </Text>
              )}

              <View
                style={[
                  styles.audioProgressContainer,
                  readerTheme === "dark" && styles.darkProgressBg,
                ]}
              >
                <View
                  style={[
                    styles.audioProgressBar,
                    { width: `${audioProgress}%` },
                  ]}
                />
              </View>

              <View style={styles.audioControls}>
                <TouchableOpacity
                  style={[
                    styles.audioButton,
                    readerTheme === "dark" && styles.darkAudioButton,
                  ]}
                  onPress={handlePlayPause}
                >
                  <Ionicons
                    name={isPlaying ? "pause" : "play"}
                    size={24}
                    color={readerTheme === "dark" ? "#FFFFFF" : "#007AFF"}
                  />
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.audioButton,
                    readerTheme === "dark" && styles.darkAudioButton,
                  ]}
                  onPress={pickAudioFile}
                >
                  <Ionicons
                    name="folder-open"
                    size={24}
                    color={readerTheme === "dark" ? "#FFFFFF" : "#007AFF"}
                  />
                </TouchableOpacity>
              </View>
            </View>

            {/* Search */}
            <View
              style={[
                styles.searchContainer,
                readerTheme === "dark" && styles.darkCardBg,
              ]}
            >
              <Text
                style={[
                  styles.searchTitle,
                  readerTheme === "dark" && styles.darkText,
                ]}
              >
                Search
              </Text>
              <View
                style={[
                  styles.searchInputContainer,
                  readerTheme === "dark" && styles.darkSearchInputContainer,
                ]}
              >
                <TextInput
                  style={[
                    styles.searchInput,
                    readerTheme === "dark" && styles.darkSearchInput,
                  ]}
                  placeholder="Search in book..."
                  placeholderTextColor={
                    readerTheme === "dark" ? "#666666" : "#999999"
                  }
                  value={searchQuery}
                  onChangeText={setSearchQuery}
                />
                <TouchableOpacity
                  style={[
                    styles.searchButton,
                    readerTheme === "dark" && styles.darkSearchButton,
                  ]}
                  onPress={handleSearch}
                >
                  <Ionicons
                    name="search"
                    size={20}
                    color={readerTheme === "dark" ? "#FFFFFF" : "#007AFF"}
                  />
                </TouchableOpacity>
              </View>

              {searchResults.length > 0 && (
                <View
                  style={[
                    styles.searchResultsContainer,
                    readerTheme === "dark" && styles.darkCardBg,
                  ]}
                >
                  <View style={styles.searchNavButtons}>
                    <TouchableOpacity
                      style={[
                        styles.searchNavButton,
                        readerTheme === "dark" && styles.darkSearchNavButton,
                      ]}
                      onPress={previousSearchResult}
                    >
                      <Ionicons
                        name="chevron-up"
                        size={20}
                        color={readerTheme === "dark" ? "#FFFFFF" : "#007AFF"}
                      />
                    </TouchableOpacity>

                    <Text
                      style={[
                        styles.searchResultCount,
                        readerTheme === "dark" && styles.darkText,
                      ]}
                    >
                      {currentSearchResult + 1} of {searchResults.length}
                    </Text>

                    <TouchableOpacity
                      style={[
                        styles.searchNavButton,
                        readerTheme === "dark" && styles.darkSearchNavButton,
                      ]}
                      onPress={nextSearchResult}
                    >
                      <Ionicons
                        name="chevron-down"
                        size={20}
                        color={readerTheme === "dark" ? "#FFFFFF" : "#007AFF"}
                      />
                    </TouchableOpacity>
                  </View>
                </View>
              )}
            </View>

            <TouchableOpacity
              style={[
                styles.quickMenuCloseButton,
                readerTheme === "dark" && styles.darkButton,
              ]}
              onPress={hideQuickMenuHandler}
            >
              <Text
                style={[
                  styles.quickMenuCloseText,
                  readerTheme === "dark" && { color: "#FFFFFF" },
                ]}
              >
                Close
              </Text>
            </TouchableOpacity>
          </View>
        </Animated.View>
      )}

      {/* TL;DR Menu (appears on swipe down) */}
      {showTldrMenu && (
        <Animated.View
          style={[
            styles.tldrMenuContainer,
            readerTheme === "dark" && styles.darkQuickMenu,
            {
              transform: [{ translateY: menuSlideAnim }],
            },
          ]}
        >
          <View style={styles.quickMenuHandle}>
            <View
              style={[
                styles.quickMenuHandleBar,
                readerTheme === "dark" && styles.darkHandleBar,
              ]}
            />
          </View>
          <View style={styles.tldrMenuContent}>
            <Text
              style={[
                styles.tldrMenuTitle,
                readerTheme === "dark" && styles.darkText,
              ]}
            >
              TL;DR
            </Text>

            {/* AI Summary */}
            <View
              style={[
                styles.aiSummaryContainer,
                readerTheme === "dark" && styles.darkCardBg,
              ]}
            >
              {isGeneratingSummary ? (
                <View style={styles.aiSummaryLoading}>
                  <ActivityIndicator
                    size="small"
                    color={readerTheme === "dark" ? "#FFFFFF" : "#007AFF"}
                  />
                  <Text
                    style={[
                      styles.aiSummaryLoadingText,
                      readerTheme === "dark" && styles.darkSubText,
                    ]}
                  >
                    Generating summary...
                  </Text>
                </View>
              ) : (
                <ScrollView style={styles.aiSummaryContent}>
                  <Text
                    style={[
                      styles.aiSummaryText,
                      readerTheme === "dark" && styles.darkText,
                    ]}
                  >
                    {aiSummary ||
                      "Swipe down to generate a summary of the current page."}
                  </Text>
                </ScrollView>
              )}

              <View style={styles.aiSummaryActions}>
                <TouchableOpacity
                  style={styles.aiSummaryButton}
                  onPress={generateAiSummary}
                  disabled={isGeneratingSummary || !currentPageText}
                >
                  <Text style={styles.aiSummaryButtonText}>
                    {aiSummary ? "Regenerate Summary" : "Generate Summary"}
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.aiSettingsButton,
                    readerTheme === "dark" && styles.darkAudioButton,
                  ]}
                  onPress={configureOllamaUrl}
                >
                  <Ionicons
                    name="settings-outline"
                    size={20}
                    color={readerTheme === "dark" ? "#FFFFFF" : "#007AFF"}
                  />
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.aiSettingsButton,
                    readerTheme === "dark" && styles.darkAudioButton,
                  ]}
                  onPress={showManualSummaryUpload}
                >
                  <Ionicons
                    name="create-outline"
                    size={20}
                    color={readerTheme === "dark" ? "#FFFFFF" : "#007AFF"}
                  />
                </TouchableOpacity>
              </View>
            </View>

            <TouchableOpacity
              style={[
                styles.quickMenuCloseButton,
                readerTheme === "dark" && styles.darkButton,
              ]}
              onPress={hideTldrMenuHandler}
            >
              <Text
                style={[
                  styles.quickMenuCloseText,
                  readerTheme === "dark" && { color: "#FFFFFF" },
                ]}
              >
                Close
              </Text>
            </TouchableOpacity>
          </View>
        </Animated.View>
      )}

      {/* Manual Summary Input Modal */}
      <Modal
        visible={showManualSummaryModal}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setShowManualSummaryModal(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          style={styles.modalContainer}
        >
          <View
            style={[
              styles.modalContent,
              readerTheme === "dark" && styles.darkModalContent,
            ]}
          >
            <View
              style={[
                styles.modalHeader,
                readerTheme === "dark" && styles.darkModalHeader,
              ]}
            >
              <Text
                style={[
                  styles.modalTitle,
                  readerTheme === "dark" && styles.darkText,
                ]}
              >
                Manual Summary
              </Text>
              <TouchableOpacity
                onPress={() => setShowManualSummaryModal(false)}
              >
                <Ionicons
                  name="close"
                  size={24}
                  color={readerTheme === "dark" ? "#FFFFFF" : "#333333"}
                />
              </TouchableOpacity>
            </View>

            <View style={styles.manualSummaryContainer}>
              <Text
                style={[
                  styles.manualSummaryLabel,
                  readerTheme === "dark" && styles.darkText,
                ]}
              >
                Enter your summary for this page:
              </Text>
              <TextInput
                style={[
                  styles.manualSummaryInput,
                  readerTheme === "dark" && styles.darkManualSummaryInput,
                ]}
                multiline={true}
                numberOfLines={6}
                value={manualSummaryText}
                onChangeText={setManualSummaryText}
                placeholder="Type your summary here..."
                placeholderTextColor={readerTheme === "dark" ? "#777" : "#999"}
              />

              <TouchableOpacity
                style={styles.saveSummaryButton}
                onPress={saveManualSummary}
              >
                <Text style={styles.saveSummaryButtonText}>Save Summary</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Table of Contents Modal */}
      <Modal
        visible={showToc}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setShowToc(false)}
      >
        <View style={styles.modalContainer}>
          <View
            style={[
              styles.modalContent,
              readerTheme === "dark" && styles.darkModalContent,
            ]}
          >
            <View
              style={[
                styles.modalHeader,
                readerTheme === "dark" && styles.darkModalHeader,
              ]}
            >
              <Text
                style={[
                  styles.modalTitle,
                  readerTheme === "dark" && styles.darkText,
                ]}
              >
                Contents
              </Text>
              <TouchableOpacity onPress={() => setShowToc(false)}>
                <Ionicons
                  name="close"
                  size={24}
                  color={readerTheme === "dark" ? "#FFFFFF" : "#333333"}
                />
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.tocList}>
              {chapterTitles.map((title, index) => (
                <TouchableOpacity
                  key={index}
                  style={[
                    styles.tocItem,
                    currentChapter === index &&
                      (readerTheme === "dark"
                        ? styles.darkTocItemActive
                        : styles.tocItemActive),
                  ]}
                  onPress={() => handleChapterChange(index)}
                >
                  <Text
                    style={[
                      styles.tocText,
                      readerTheme === "dark" && styles.darkText,
                      currentChapter === index &&
                        (readerTheme === "dark"
                          ? styles.darkTocTextActive
                          : styles.tocTextActive),
                    ]}
                  >
                    {title}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            <View
              style={[
                styles.settingsSection,
                readerTheme === "dark" && styles.darkSettingsSection,
              ]}
            >
              <Text
                style={[
                  styles.settingsLabel,
                  readerTheme === "dark" && styles.darkText,
                ]}
              >
                Display Settings
              </Text>

              <View style={styles.fontSizeControls}>
                <Text
                  style={[
                    styles.settingsSubLabel,
                    readerTheme === "dark" && styles.darkText,
                  ]}
                >
                  Font Size
                </Text>
                <View style={styles.fontSizeButtonsRow}>
                  <TouchableOpacity
                    style={[
                      styles.fontSizeButton,
                      readerTheme === "dark" && styles.darkButton,
                    ]}
                    onPress={() =>
                      handleFontSizeChange(Math.max(70, fontSize - 10))
                    }
                  >
                    <Text
                      style={[
                        styles.fontSizeButtonText,
                        readerTheme === "dark" && { color: "#FFFFFF" },
                      ]}
                    >
                      A-
                    </Text>
                  </TouchableOpacity>
                  <Text
                    style={[
                      styles.fontSizeValue,
                      readerTheme === "dark" && styles.darkText,
                    ]}
                  >
                    {fontSize}%
                  </Text>
                  <TouchableOpacity
                    style={[
                      styles.fontSizeButton,
                      readerTheme === "dark" && styles.darkButton,
                    ]}
                    onPress={() =>
                      handleFontSizeChange(Math.min(200, fontSize + 10))
                    }
                  >
                    <Text
                      style={[
                        styles.fontSizeButtonText,
                        readerTheme === "dark" && { color: "#FFFFFF" },
                      ]}
                    >
                      A+
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>

              <View style={styles.themeButtons}>
                <Text
                  style={[
                    styles.settingsSubLabel,
                    readerTheme === "dark" && styles.darkText,
                  ]}
                >
                  Theme
                </Text>
                <View style={styles.themeButtonsRow}>
                  <TouchableOpacity
                    style={[
                      styles.themeButton,
                      styles.lightThemeButton,
                      readerTheme === "light" && styles.activeThemeButton,
                    ]}
                    onPress={() => handleThemeChange("light")}
                  >
                    <Text style={styles.themeButtonText}>Light</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[
                      styles.themeButton,
                      styles.darkThemeButton,
                      readerTheme === "dark" && styles.activeThemeButton,
                    ]}
                    onPress={() => handleThemeChange("dark")}
                  >
                    <Text
                      style={[styles.themeButtonText, styles.darkThemeText]}
                    >
                      Dark
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[
                      styles.themeButton,
                      styles.sepiaThemeButton,
                      readerTheme === "sepia" && styles.activeThemeButton,
                    ]}
                    onPress={() => handleThemeChange("sepia")}
                  >
                    <Text style={styles.themeButtonText}>Sepia</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
};

// Main App Component
export default function App() {
  return (
    <ThemeProvider>
      <NavigationContainer>
        <Stack.Navigator>
          <Stack.Screen
            name="Library"
            component={LibraryScreen}
            options={{
              headerShown: false,
            }}
          />
          <Stack.Screen
            name="Reader"
            component={ReaderScreen}
            options={{
              headerShown: false, // Hide the navigation header
              gestureEnabled: false, // Disable swipe back gesture
            }}
          />
        </Stack.Navigator>
      </NavigationContainer>
    </ThemeProvider>
  );
}

// Update the styles for the enhanced library page
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#F2F2F7",
  },
  darkBackground: {
    backgroundColor: "#111827",
  },
  centeredContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
    backgroundColor: "#F2F2F7",
  },
  header: {
    paddingHorizontal: 16,
    paddingVertical: 16,
    backgroundColor: "#FFFFFF",
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#E0E0E0",
    elevation: 0,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 1,
  },
  darkHeader: {
    backgroundColor: "#1F2937",
    borderBottomColor: "#374151",
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: "bold",
    color: "#000000",
  },
  darkText: {
    color: "#F9FAFB",
  },
  darkSubText: {
    color: "#9CA3AF",
  },
  headerButtons: {
    flexDirection: "row",
    alignItems: "center",
  },
  headerButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#F2F2F7",
    justifyContent: "center",
    alignItems: "center",
    marginLeft: 8,
  },
  darkHeaderButton: {
    backgroundColor: "#374151",
  },
  statsContainer: {
    flexDirection: "row",
    justifyContent: "space-around",
    padding: 16,
    margin: 16,
    borderRadius: 16,
    backgroundColor: "#FFFFFF",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  darkStatsContainer: {
    backgroundColor: "#1F2937",
  },
  statItem: {
    alignItems: "center",
    flex: 1,
  },
  statValue: {
    fontSize: 24,
    fontWeight: "bold",
    marginBottom: 4,
    color: "#1C1C1E",
  },
  statLabel: {
    fontSize: 14,
    color: "#666",
  },
  searchContainer: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: "#FFFFFF",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#E0E0E0",
  },
  darkSearchContainer: {
    backgroundColor: "#1F2937",
    borderBottomColor: "#374151",
  },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#EFEFF4",
    borderRadius: 10,
    paddingHorizontal: 10,
    height: 36,
  },
  darkSearchBar: {
    backgroundColor: "#374151",
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    height: 36,
    fontSize: 16,
    color: "#000000",
  },
  darkSearchInput: {
    color: "#F9FAFB",
  },
  emptyLibrary: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 32,
  },
  emptyIconContainer: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: "#F2F2F7",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 20,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 2,
  },
  darkEmptyIconContainer: {
    backgroundColor: "#1F2937",
    shadowColor: "#000",
  },
  emptyText: {
    fontSize: 22,
    fontWeight: "600",
    marginTop: 16,
    marginBottom: 8,
    color: "#333",
  },
  emptySubText: {
    fontSize: 16,
    color: "#666",
    textAlign: "center",
    marginBottom: 24,
  },
  emptyAddButton: {
    backgroundColor: "#007AFF",
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 12,
    shadowColor: "#007AFF",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 4,
  },
  darkEmptyAddButton: {
    backgroundColor: "#3B82F6",
    shadowColor: "#3B82F6",
  },
  emptyAddButtonText: {
    color: "white",
    fontSize: 16,
    fontWeight: "600",
  },
  bookGrid: {
    padding: 12,
  },
  bookCard: {
    width: (width - 36) / 2,
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    margin: 6,
    overflow: "hidden",
    elevation: 2,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.07,
    shadowRadius: 8,
    position: "relative",
    height: 260,
  },
  darkBookCard: {
    backgroundColor: "#1F2937",
    shadowColor: "#000",
  },
  coverContainer: {
    width: "100%",
    height: 180,
    position: "relative",
  },
  coverImage: {
    width: "100%",
    height: "100%",
  },
  placeholderCover: {
    width: "100%",
    height: "100%",
    backgroundColor: "#F2F2F7",
    justifyContent: "center",
    alignItems: "center",
  },
  darkPlaceholderCover: {
    backgroundColor: "#374151",
  },
  progressBarContainer: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    padding: 8,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
  },
  progressBar: {
    height: 4,
    backgroundColor: "rgba(255, 255, 255, 0.3)",
    borderRadius: 2,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    backgroundColor: "#FFFFFF",
  },
  progressText: {
    color: "#FFFFFF",
    fontSize: 12,
    marginTop: 4,
    textAlign: "center",
  },
  bookInfo: {
    padding: 12,
  },
  bookTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: "#1C1C1E",
    marginBottom: 4,
  },
  bookDate: {
    fontSize: 12,
    color: "#8E8E93",
  },
  removeButton: {
    position: "absolute",
    top: 12,
    right: 12,
  },
  noResultsContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 32,
  },
  noResultsText: {
    fontSize: 16,
    color: "#8E8E93",
    marginTop: 16,
    textAlign: "center",
  },
  // Keep all other styles...
  readerContainer: {
    flex: 1,
    backgroundColor: "#FFFFFF",
  },
  darkContainer: {
    backgroundColor: "#000000",
  },
  readerStatusBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: 44,
    paddingBottom: 8,
    backgroundColor: "rgba(255, 255, 255, 0.8)",
    backdropFilter: "blur(10px)",
  },
  darkStatusBar: {
    backgroundColor: "rgba(0, 0, 0, 0.8)",
  },
  backButton: {
    padding: 8,
    borderRadius: 8,
  },
  bookTitle: {
    fontSize: 17,
    fontWeight: "600",
    color: "#000000",
    textAlign: "center",
    flex: 1,
    marginHorizontal: 8,
  },
  darkText: {
    color: "#FFFFFF",
  },
  tocButton: {
    padding: 8,
    borderRadius: 8,
  },
  webViewContainer: {
    flex: 1,
    backgroundColor: "#FFFFFF",
  },
  webView: {
    flex: 1,
  },
  tapZonesContainer: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: "row",
  },
  leftTapZone: {
    flex: 1,
    height: "100%",
  },
  centerTapZone: {
    width: 1,
    height: "100%",
  },
  rightTapZone: {
    flex: 1,
    height: "100%",
  },
  pageIndicator: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    padding: 16,
    backgroundColor: "rgba(255, 255, 255, 0.8)",
    backdropFilter: "blur(10px)",
    borderTopWidth: 1,
    borderTopColor: "rgba(0, 0, 0, 0.1)",
  },
  darkPageIndicator: {
    backgroundColor: "rgba(0, 0, 0, 0.8)",
    borderTopColor: "rgba(255, 255, 255, 0.1)",
  },
  pageIndicatorText: {
    fontSize: 13,
    color: "#666666",
    textAlign: "center",
  },
  quickMenuContainer: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: "#FFFFFF",
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 5,
  },
  darkQuickMenu: {
    backgroundColor: "#1C1C1E",
  },
  quickMenuHandle: {
    alignItems: "center",
    paddingTop: 8,
  },
  quickMenuHandleBar: {
    width: 36,
    height: 5,
    backgroundColor: "#E5E5EA",
    borderRadius: 2.5,
  },
  darkHandleBar: {
    backgroundColor: "#3A3A3C",
  },
  quickMenuContent: {
    padding: 16,
  },
  quickMenuTitle: {
    fontSize: 17,
    fontWeight: "600",
    color: "#000000",
    marginBottom: 16,
  },
  quickMenuCloseButton: {
    margin: 16,
    padding: 12,
    backgroundColor: "#007AFF",
    borderRadius: 10,
    alignItems: "center",
  },
  darkButton: {
    backgroundColor: "#0A84FF",
  },
  quickMenuCloseText: {
    color: "#FFFFFF",
    fontSize: 17,
    fontWeight: "600",
  },
  audioPlayerContainer: {
    backgroundColor: "#F2F2F7",
    borderRadius: 20,
    padding: 20,
    marginBottom: 24,
  },
  darkCardBg: {
    backgroundColor: "#2C2C2E",
  },
  audioPlayerTitle: {
    fontSize: 17,
    fontWeight: "600",
    marginBottom: 12,
    color: "#1C1C1E",
  },
  audioFileName: {
    fontSize: 15,
    color: "#666",
    marginBottom: 12,
    fontStyle: "italic",
  },
  audioFilePrompt: {
    fontSize: 14,
    color: "#888",
    marginBottom: 10,
    fontStyle: "italic",
    textAlign: "center",
  },
  audioProgressContainer: {
    height: 4,
    backgroundColor: "#E0E0E0",
    borderRadius: 2,
    marginBottom: 16,
    overflow: "hidden",
  },
  darkProgressBg: {
    backgroundColor: "#444444",
  },
  audioProgressBar: {
    height: "100%",
    backgroundColor: "#007AFF",
  },
  audioControls: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 16,
  },
  audioButton: {
    width: 56,
    height: 56,
    backgroundColor: "#FFFFFF",
    borderRadius: 28,
    justifyContent: "center",
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  darkAudioButton: {
    backgroundColor: "#3A3A3C",
  },
  aiSummaryContainer: {
    backgroundColor: "#F2F2F7",
    borderRadius: 16,
    padding: 15,
    marginBottom: 20,
  },
  aiSummaryTitle: {
    fontSize: 18,
    fontWeight: "600",
    marginBottom: 10,
    color: "#333",
  },
  aiSummaryContent: {
    maxHeight: 150,
    marginBottom: 10,
  },
  aiSummaryText: {
    fontSize: 14,
    lineHeight: 20,
    color: "#333",
  },
  aiSummaryLoading: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
  },
  aiSummaryLoadingText: {
    marginLeft: 10,
    fontSize: 14,
    color: "#666",
  },
  aiSummaryActions: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  aiSummaryButton: {
    backgroundColor: "#007AFF",
    padding: 10,
    borderRadius: 12,
    alignItems: "center",
    flex: 1,
    marginRight: 10,
  },
  aiSummaryButtonText: {
    color: "#FFF",
    fontSize: 14,
    fontWeight: "500",
  },
  aiSettingsButton: {
    width: 40,
    height: 40,
    backgroundColor: "#FFFFFF",
    borderRadius: 20,
    justifyContent: "center",
    alignItems: "center",
  },
  modalContainer: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.4)",
    justifyContent: "flex-end",
  },
  modalContent: {
    backgroundColor: "#FFFFFF",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: "80%",
  },
  darkModalContent: {
    backgroundColor: "#1C1C1E",
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: "#E0E0E0",
  },
  darkModalHeader: {
    borderBottomColor: "#2C2C2E",
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: "600",
    color: "#1C1C1E",
  },
  tocList: {
    padding: 16,
  },
  tocItem: {
    paddingVertical: 16,
    paddingHorizontal: 20,
    borderBottomWidth: 1,
    borderBottomColor: "#F0F0F0",
    borderRadius: 12,
    marginBottom: 4,
  },
  tocItemActive: {
    backgroundColor: "#F2F2F7",
  },
  darkTocItemActive: {
    backgroundColor: "#2C2C2E",
    borderBottomColor: "#2C2C2E",
  },
  tocText: {
    fontSize: 16,
    color: "#1C1C1E",
  },
  tocTextActive: {
    color: "#007AFF",
    fontWeight: "600",
  },
  darkTocTextActive: {
    color: "#0A84FF",
    fontWeight: "600",
  },
  settingsSection: {
    padding: 20,
    borderTopWidth: 1,
    borderTopColor: "#E0E0E0",
  },
  darkSettingsSection: {
    borderTopColor: "#2C2C2E",
  },
  settingsLabel: {
    fontSize: 20,
    fontWeight: "600",
    marginBottom: 20,
    color: "#1C1C1E",
  },
  settingsSubLabel: {
    fontSize: 17,
    fontWeight: "500",
    marginBottom: 12,
    color: "#1C1C1E",
  },
  fontSizeControls: {
    marginBottom: 24,
  },
  fontSizeButtonsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 16,
  },
  fontSizeButton: {
    width: 44,
    height: 44,
    backgroundColor: "#F2F2F7",
    borderRadius: 22,
    justifyContent: "center",
    alignItems: "center",
  },
  fontSizeButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#007AFF",
  },
  fontSizeValue: {
    fontSize: 16,
    color: "#1C1C1E",
    marginHorizontal: 12,
    width: 50,
    textAlign: "center",
  },
  themeButtons: {
    marginTop: 16,
  },
  themeButtonsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 12,
  },
  themeButton: {
    flex: 1,
    padding: 16,
    borderRadius: 16,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#E0E0E0",
  },
  lightThemeButton: {
    backgroundColor: "#FFFFFF",
  },
  darkThemeButton: {
    backgroundColor: "#1C1C1E",
    borderColor: "#2C2C2E",
  },
  sepiaThemeButton: {
    backgroundColor: "#f4ecd8",
  },
  activeThemeButton: {
    borderColor: "#007AFF",
    borderWidth: 2,
  },
  themeButtonText: {
    fontSize: 15,
    fontWeight: "500",
    color: "#1C1C1E",
  },
  darkThemeText: {
    color: "#FFFFFF",
  },
  errorText: {
    fontSize: 16,
    color: "#FF3B30",
    textAlign: "center",
  },
  // New styles for manual summary upload
  manualSummaryContainer: {
    padding: 16,
  },
  manualSummaryLabel: {
    fontSize: 16,
    fontWeight: "500",
    marginBottom: 10,
    color: "#333",
  },
  manualSummaryInput: {
    borderWidth: 1,
    borderColor: "#E0E0E0",
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    color: "#333",
    backgroundColor: "#F9F9F9",
    minHeight: 120,
    textAlignVertical: "top",
    marginBottom: 16,
  },
  darkManualSummaryInput: {
    borderColor: "#3A3A3C",
    backgroundColor: "#2C2C2E",
    color: "#FFFFFF",
  },
  saveSummaryButton: {
    backgroundColor: "#007AFF",
    padding: 14,
    borderRadius: 12,
    alignItems: "center",
  },
  saveSummaryButtonText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "600",
  },
  // New styles for page transition settings
  transitionContainer: {
    backgroundColor: "#F2F2F7",
    borderRadius: 20,
    padding: 20,
    marginBottom: 24,
  },
  transitionTitle: {
    fontSize: 17,
    fontWeight: "600",
    marginBottom: 16,
    color: "#1C1C1E",
  },
  transitionButtons: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 12,
  },
  transitionButton: {
    flex: 1,
    padding: 12,
    borderRadius: 12,
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E0E0E0",
  },
  activeTransitionButton: {
    borderColor: "#007AFF",
    borderWidth: 2,
  },
  transitionButtonText: {
    fontSize: 15,
    color: "#1C1C1E",
  },
  activeTransitionText: {
    color: "#007AFF",
    fontWeight: "600",
  },
  // New styles for search
  searchContainer: {
    backgroundColor: "#F2F2F7",
    borderRadius: 20,
    padding: 20,
    marginBottom: 24,
  },
  searchTitle: {
    fontSize: 17,
    fontWeight: "600",
    marginBottom: 16,
    color: "#1C1C1E",
  },
  searchInputContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderRadius: 12,
    paddingHorizontal: 12,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: "#E0E0E0",
  },
  darkSearchInputContainer: {
    backgroundColor: "#2C2C2E",
    borderColor: "#3A3A3C",
  },
  searchInput: {
    flex: 1,
    height: 44,
    fontSize: 16,
    color: "#1C1C1E",
    paddingHorizontal: 8,
  },
  darkSearchInput: {
    color: "#FFFFFF",
  },
  searchButton: {
    padding: 8,
  },
  darkSearchButton: {
    backgroundColor: "#2C2C2E",
  },
  searchResultsContainer: {
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    padding: 16,
  },
  searchResultsText: {
    fontSize: 14,
    color: "#333",
  },
  searchNavigation: {
    flexDirection: "row",
    alignItems: "center",
  },
  searchNavButtons: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 16,
  },
  searchNavButton: {
    width: 40,
    height: 40,
    backgroundColor: "#F2F2F7",
    borderRadius: 20,
    justifyContent: "center",
    alignItems: "center",
  },
  darkSearchNavButton: {
    backgroundColor: "#2C2C2E",
  },
  searchResultCounter: {
    fontSize: 14,
    color: "#333",
    marginHorizontal: 8,
    minWidth: 40,
    textAlign: "center",
  },
  tldrMenuContainer: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: "#FFFFFF",
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 5,
    maxHeight: "80%", // Limit maximum height to 80% of screen
  },
  tldrMenuContent: {
    padding: 16,
    flex: 1, // Allow content to expand
  },
  tldrMenuTitle: {
    fontSize: 17,
    fontWeight: "600",
    color: "#000000",
    marginBottom: 16,
    textAlign: "center",
  },
});
