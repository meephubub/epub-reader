"use client";

import { useState, useEffect, useRef } from "react";
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

// Components
const Stack = createStackNavigator();
const { width, height } = Dimensions.get("window");

// Library Screen to list books
const LibraryScreen = ({ navigation }) => {
  const [books, setBooks] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadBooks();
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
      const updatedBooks = books.filter((book) => book.id !== id);
      setBooks(updatedBooks);
      await AsyncStorage.setItem("books", JSON.stringify(updatedBooks));

      // Remove book files
      const bookDir = `${FileSystem.documentDirectory}books/${id}/`;
      await FileSystem.deleteAsync(bookDir, { idempotent: true });
    } catch (error) {
      console.error("Error removing book:", error);
    }
  };

  const openBook = async (book) => {
    // Update the last opened timestamp
    const updatedBooks = books.map((b) =>
      b.id === book.id ? { ...b, lastOpenedAt: new Date().toISOString() } : b,
    );
    setBooks(updatedBooks);
    await AsyncStorage.setItem("books", JSON.stringify(updatedBooks));

    // Navigate to reader
    navigation.navigate("Reader", { book });
  };

  if (loading) {
    return (
      <View style={styles.centeredContainer}>
        <ActivityIndicator size="large" color="#6200EE" />
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>My Library</Text>
        <TouchableOpacity style={styles.addButton} onPress={pickDocument}>
          <Ionicons name="add-circle" size={24} color="#6200EE" />
          <Text style={styles.addButtonText}>Add Book</Text>
        </TouchableOpacity>
      </View>

      {books.length === 0 ? (
        <View style={styles.emptyLibrary}>
          <Ionicons name="book-outline" size={80} color="#CCCCCC" />
          <Text style={styles.emptyText}>Your library is empty</Text>
          <Text style={styles.emptySubText}>
            Tap "Add Book" to import an ePub
          </Text>
          <TouchableOpacity
            style={styles.emptyAddButton}
            onPress={pickDocument}
          >
            <Text style={styles.emptyAddButtonText}>Add Book</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={books}
          keyExtractor={(item) => item.id}
          numColumns={2}
          contentContainerStyle={styles.bookGrid}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.bookCard}
              onPress={() => openBook(item)}
              activeOpacity={0.7}
            >
              <View style={styles.coverContainer}>
                {item.coverUrl ? (
                  <Image
                    source={{ uri: item.coverUrl }}
                    style={styles.coverImage}
                    resizeMode="cover"
                  />
                ) : (
                  <View style={styles.placeholderCover}>
                    <Ionicons name="book" size={40} color="#CCCCCC" />
                  </View>
                )}
                {item.progress > 0 && (
                  <View style={styles.progressBar}>
                    <View
                      style={[
                        styles.progressFill,
                        { width: `${item.progress * 100}%` },
                      ]}
                    />
                  </View>
                )}
              </View>
              <View style={styles.bookInfo}>
                <Text style={styles.bookTitle} numberOfLines={2}>
                  {item.title}
                </Text>
                <Text style={styles.bookDate}>
                  {new Date(item.lastOpenedAt).toLocaleDateString()}
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => removeBook(item.id)}
                style={styles.removeButton}
              >
                <Ionicons name="trash-outline" size={18} color="#FF3B30" />
              </TouchableOpacity>
            </TouchableOpacity>
          )}
        />
      )}
      <StatusBar style="auto" />
    </SafeAreaView>
  );
};

// Reader Screen for displaying ePub content
const ReaderScreen = ({ route, navigation }) => {
  const { book } = route.params;
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
  const [fontSize, setFontSize] = useState(100);
  const [theme, setTheme] = useState("light");
  const [isPageTurning, setIsPageTurning] = useState(false);
  const [currentPageText, setCurrentPageText] = useState("");
  const [aiSummary, setAiSummary] = useState("");
  const [isGeneratingSummary, setIsGeneratingSummary] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [audioProgress, setAudioProgress] = useState(0);
  const [audioFile, setAudioFile] = useState(null);
  const [sound, setSound] = useState(null);
  const [ollamaUrl, setOllamaUrl] = useState("http://localhost:11434");
  const webViewRef = useRef(null);
  const menuSlideAnim = useRef(new Animated.Value(height)).current;
  const audioProgressInterval = useRef(null);

  // Create pan responder for swipe gestures with improved detection
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (evt, gestureState) => {
        return Math.abs(gestureState.dx) > 15 || Math.abs(gestureState.dy) > 15;
      },
      onPanResponderGrant: () => {
        // Capture start of gesture
      },
      onPanResponderMove: (evt, gestureState) => {
        // Optional: Add visual feedback during swipe
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
        } else if (isVerticalSwipe && gestureState.dy < -50) {
          // Swipe up - show quick menu
          showQuickMenuHandler();
        }
      },
    }),
  ).current;

  // Function to show the quick menu
  const showQuickMenuHandler = () => {
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
  };

  // Extract text from current page
  const extractCurrentPageText = () => {
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
          text: "OK",
          onPress: (url) => {
            if (url && url.trim() !== "") {
              setOllamaUrl(url.trim());
            }
          },
        },
      ],
      "plain-text",
      ollamaUrl,
    );
  };

  // Generate AI summary using Ollama API
  const generateAiSummary = async () => {
    if (!currentPageText || currentPageText.length < 10) {
      setAiSummary("Not enough text on this page to generate a summary.");
      return;
    }

    setIsGeneratingSummary(true);

    try {
      // Try to detect local IP address for Ollama
      const ipAddresses = [
        "localhost",
        "192.168.1.183",
        "192.168.0.168",
        "192.168.1.102",
      ];
      let summaryGenerated = false;

      for (const ip of ipAddresses) {
        if (summaryGenerated) break;

        try {
          const apiUrl = `http://${ip}:11434/api/generate`;
          console.log(`Trying Ollama API at: ${apiUrl}`);

          const response = await fetch(apiUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model: "llama3",
              prompt: `Summarize the following text in 2-3 sentences: ${currentPageText}`,
              stream: false,
            }),
          });

          if (response.ok) {
            const data = await response.json();
            setAiSummary(data.response);
            setOllamaUrl(`http://${ip}:11434`); // Remember successful URL
            summaryGenerated = true;
            console.log(`Successfully connected to Ollama at ${ip}`);
          }
        } catch (error) {
          console.log(`Failed to connect to Ollama at ${ip}: ${error.message}`);
        }
      }

      if (!summaryGenerated) {
        // If all automatic attempts failed, try the user-configured URL
        try {
          const response = await fetch(`${ollamaUrl}/api/generate`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model: "llama3",
              prompt: `Summarize the following text in 2-3 sentences: ${currentPageText}`,
              stream: false,
            }),
          });

          if (response.ok) {
            const data = await response.json();
            setAiSummary(data.response);
          } else {
            throw new Error(`HTTP error ${response.status}`);
          }
        } catch (error) {
          console.error(
            `Error with user-configured Ollama URL: ${error.message}`,
          );
          setAiSummary(
            "Failed to generate summary. Please check your Ollama API connection or tap the settings icon to configure the API URL.",
          );
        }
      }
    } catch (error) {
      console.error("Error generating AI summary:", error);
      setAiSummary(
        "Failed to generate summary. Please check your Ollama API connection or tap the settings icon to configure the API URL.",
      );
    } finally {
      setIsGeneratingSummary(false);
    }
  };

  // Pick audio file from device
  const pickAudioFile = async () => {
    try {
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
  const handlePlayAudio = async () => {
    try {
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

      setIsPlaying(true);

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
    if (sound) {
      await sound.pauseAsync();
      setIsPlaying(false);
      clearInterval(audioProgressInterval.current);
    }
  };

  const handleStopAudio = async () => {
    if (sound) {
      await sound.stopAsync();
      await sound.setPositionAsync(0);
      setIsPlaying(false);
      setAudioProgress(0);
      clearInterval(audioProgressInterval.current);
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

  // Improved page turning functions
  const handleNextPage = () => {
    if (isPageTurning) return;

    if (currentPage < totalPages - 1) {
      setIsPageTurning(true);
      // Go to next page in current chapter
      const newPage = currentPage + 1;

      // Use the improved page turning function
      webViewRef.current?.injectJavaScript(`
        goToPage(${newPage});
        true;
      `);

      // Update state after a short delay to ensure WebView has time to process
      setTimeout(() => {
        setCurrentPage(newPage);
        setPagesLeftInChapter(totalPages - newPage - 1);
        saveProgress(currentChapter, newPage, totalPages);
        setIsPageTurning(false);
      }, 300); // Increased delay to match transition time
    } else if (currentChapter < chapters.length - 1) {
      // Go to next chapter
      setIsPageTurning(true);
      const newChapter = currentChapter + 1;
      setCurrentChapter(newChapter);
      setCurrentPage(0);
      saveProgress(newChapter, 0, totalPages);

      // Reset page turning flag after chapter change is complete
      setTimeout(() => {
        setIsPageTurning(false);
      }, 500);
    } else {
      setIsPageTurning(false);
    }
  };

  const handlePreviousPage = () => {
    if (isPageTurning) return;

    if (currentPage > 0) {
      setIsPageTurning(true);
      // Go to previous page in current chapter
      const newPage = currentPage - 1;

      // Use the improved page turning function
      webViewRef.current?.injectJavaScript(`
        goToPage(${newPage});
        true;
      `);

      // Update state after a short delay to ensure WebView has time to process
      setTimeout(() => {
        setCurrentPage(newPage);
        setPagesLeftInChapter(totalPages - newPage - 1);
        saveProgress(currentChapter, newPage, totalPages);
        setIsPageTurning(false);
      }, 300); // Increased delay to match transition time
    } else if (currentChapter > 0) {
      // Go to previous chapter
      setIsPageTurning(true);
      const newChapter = currentChapter - 1;
      setCurrentChapter(newChapter);
      // We'll set the page to the last page once we know how many pages there are
      setCurrentPage(0);
      saveProgress(newChapter, 0, totalPages);

      // Reset page turning flag after chapter change is complete
      setTimeout(() => {
        setIsPageTurning(false);
      }, 500);
    } else {
      setIsPageTurning(false);
    }
  };

  // Extract and parse ePub content
  useEffect(() => {
    const extractEpubContent = async () => {
      try {
        setLoading(true);

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
          interruptionModeIOS: Audio.InterruptionModeIOS.DoNotMix,
          playsInSilentModeIOS: true,
          shouldDuckAndroid: true,
          interruptionModeAndroid: Audio.InterruptionModeAndroid.DoNotMix,
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
  useEffect(() => {
    return () => {
      if (audioProgressInterval.current) {
        clearInterval(audioProgressInterval.current);
      }
      if (sound) {
        sound.unloadAsync();
      }
    };
  }, [sound]);

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
    setCurrentChapter(index);
    setCurrentPage(0);
    setShowToc(false);
    saveProgress(index, 0, totalPages);
  };

  const handleFontSizeChange = (size) => {
    setFontSize(size);
    webViewRef.current?.injectJavaScript(`
      document.body.style.fontSize = '${size}%';
      paginateContent();
      true;
    `);
  };

  const handleThemeChange = (newTheme) => {
    setTheme(newTheme);
    webViewRef.current?.injectJavaScript(`
      document.body.className = '${newTheme}-theme';
      true;
    `);
  };

  const handleMessage = (event) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      if (data.type === "pageCount") {
        setTotalPages(data.pages);
        setPagesLeftInChapter(data.pages - currentPage - 1);
        saveProgress(currentChapter, currentPage, data.pages);
      } else if (data.type === "pageChanged") {
        // Confirm page change was successful
        console.log("Page changed to:", data.page, "Success:", data.success);
      } else if (data.type === "pageText") {
        // Handle extracted page text
        setCurrentPageText(data.text);
        // Generate AI summary when we get the page text
        generateAiSummary();
      }
    } catch (error) {
      console.error("Error parsing WebView message:", error);
    }
  };

  if (loading) {
    return (
      <View style={styles.centeredContainer}>
        <ActivityIndicator size="large" color="#000" />
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
          font-family: 'Georgia', serif;
          line-height: 1.6;
          font-size: ${fontSize}%;
          transition: all 0.3s ease;
          padding: 0;
          -webkit-user-select: none;
          user-select: none;
          touch-action: none;
        }
        .light-theme {
          color: #333;
          background-color: #fff;
        }
        .dark-theme {
          color: #eee;
          background-color: #222;
        }
        .sepia-theme {
          color: #5b4636;
          background-color: #f4ecd8;
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
          font-size: 1.5em;
          font-weight: bold;
          margin: 1em 0;
          padding: 0 20px;
        }
        #chapter-divider {
          text-align: center;
          margin: 0.5em 0 1.5em;
          font-size: 1.2em;
          color: #888;
        }
        #book-content-wrapper {
          position: relative;
          height: calc(100vh - 120px);
          width: 100%;
          overflow: hidden;
        }
        #book-content {
          position: absolute;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          display: flex;
          flex-direction: row;
          transition: transform 0.3s ease;
        }
        .page {
          width: 100%;
          height: 100%;
          flex: 0 0 100%;
          padding: 0 20px 40px;
          box-sizing: border-box;
          overflow: hidden;
        }
        img {
          max-width: 100%;
          height: auto;
        }
        h1, h2, h3, h4, h5, h6 {
          line-height: 1.3;
        }
        p {
          margin-bottom: 1em;
          text-align: justify;
        }
        #page-footer {
          position: fixed;
          bottom: 10px;
          width: 100%;
          text-align: center;
          font-size: 0.8em;
          color: #888;
          z-index: 10;
        }
      </style>
    </head>
    <body class="${theme}-theme">
      <div id="book-container">
        <div id="chapter-title">${chapterTitles[currentChapter]}</div>
        <div id="chapter-divider">&#9679; &#9679; &#9679;</div>
        <div id="book-content-wrapper">
          <div id="book-content">
            <!-- Pages will be created dynamically -->
          </div>
        </div>
        <div id="page-footer">
          <span id="page-number"></span>
        </div>
      </div>
      <script>
        // Parse and paginate the content
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
          tempContainer.style.fontFamily = 'Georgia, serif';
          tempContainer.style.fontSize = '${fontSize}%';
          tempContainer.style.lineHeight = '1.6';
          document.body.appendChild(tempContainer);

          // Parse the HTML content
          const parser = new DOMParser();
          const doc = parser.parseFromString(rawContent, 'text/html');
          const nodes = Array.from(doc.body.childNodes);

          // Create pages
          let currentPage = document.createElement('div');
          currentPage.className = 'page';
          content.appendChild(currentPage);

          let pageHeight = contentWrapper.offsetHeight;
          let currentHeight = 0;

          // Process each node
          nodes.forEach(node => {
            // Clone the node to measure it
            const clonedNode = node.cloneNode(true);
            tempContainer.appendChild(clonedNode);
            const nodeHeight = clonedNode.offsetHeight;
            tempContainer.removeChild(clonedNode);

            // Check if node fits in current page
            if (currentHeight + nodeHeight > pageHeight) {
              // Create a new page
              currentPage = document.createElement('div');
              currentPage.className = 'page';
              content.appendChild(currentPage);
              currentHeight = 0;
            }

            // Add node to current page
            currentPage.appendChild(node.cloneNode(true));
            currentHeight += nodeHeight;
          });

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

          // Go to current page
          goToPage(${currentPage});
        }

        // Function to update page number display
        function updatePageNumber(current, total) {
          const pageNumber = document.getElementById('page-number');
          if (pageNumber) {
            pageNumber.textContent = current + ' of ' + total;
          }
        }

        // Improved function to go to a specific page
        function goToPage(pageIndex) {
          const content = document.getElementById('book-content');
          if (!content) return;

          // Get total pages
          const totalPages = content.children.length;

          // Ensure page index is within bounds
          pageIndex = Math.max(0, Math.min(pageIndex, totalPages - 1));

          // Use transform for smoother transitions
          content.style.transform = \`translateX(-\${pageIndex * 100}%)\`;

          // Update page number
          updatePageNumber(pageIndex + 1, totalPages);

          // Confirm page change to React Native
          window.ReactNativeWebView.postMessage(JSON.stringify({
            type: 'pageChanged',
            page: pageIndex,
            success: true
          }));
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
    <View style={styles.readerContainer}>
      {/* Status bar area */}
      <View style={styles.readerStatusBar}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
        >
          <Ionicons name="chevron-back" size={24} color="#000" />
          <Text style={styles.pagesLeftText}>
            {pagesLeftInChapter} pages left in chapter
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.closeButton}
          onPress={() => navigation.goBack()}
        >
          <Ionicons name="close" size={24} color="#000" />
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

      {/* Bottom menu button */}
      <TouchableOpacity
        style={styles.menuButton}
        onPress={() => setShowToc(true)}
      >
        <Ionicons name="menu" size={24} color="#000" />
      </TouchableOpacity>

      {/* Quick Menu (appears on swipe up) */}
      {showQuickMenu && (
        <Animated.View
          style={[
            styles.quickMenuContainer,
            {
              transform: [{ translateY: menuSlideAnim }],
            },
          ]}
        >
          <View style={styles.quickMenuHandle}>
            <View style={styles.quickMenuHandleBar} />
          </View>

          <View style={styles.quickMenuContent}>
            <Text style={styles.quickMenuTitle}>Quick Menu</Text>

            {/* Audio Player */}
            <View style={styles.audioPlayerContainer}>
              <Text style={styles.audioPlayerTitle}>Audio Player</Text>

              {audioFile ? (
                <Text style={styles.audioFileName} numberOfLines={1}>
                  {audioFile.name}
                </Text>
              ) : (
                <Text style={styles.audioFilePrompt}>
                  No audio file selected
                </Text>
              )}

              <View style={styles.audioProgressContainer}>
                <View
                  style={[
                    styles.audioProgressBar,
                    { width: `${audioProgress}%` },
                  ]}
                />
              </View>

              <View style={styles.audioControls}>
                {!isPlaying ? (
                  <TouchableOpacity
                    style={styles.audioButton}
                    onPress={handlePlayAudio}
                  >
                    <Ionicons name="play" size={24} color="#6200EE" />
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity
                    style={styles.audioButton}
                    onPress={handlePauseAudio}
                  >
                    <Ionicons name="pause" size={24} color="#6200EE" />
                  </TouchableOpacity>
                )}

                <TouchableOpacity
                  style={styles.audioButton}
                  onPress={handleStopAudio}
                >
                  <Ionicons name="stop" size={24} color="#6200EE" />
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.audioButton}
                  onPress={pickAudioFile}
                >
                  <Ionicons name="folder-open" size={24} color="#6200EE" />
                </TouchableOpacity>
              </View>
            </View>

            {/* AI Summary */}
            <View style={styles.aiSummaryContainer}>
              <Text style={styles.aiSummaryTitle}>AI Summary</Text>

              {isGeneratingSummary ? (
                <View style={styles.aiSummaryLoading}>
                  <ActivityIndicator size="small" color="#6200EE" />
                  <Text style={styles.aiSummaryLoadingText}>
                    Generating summary...
                  </Text>
                </View>
              ) : (
                <ScrollView style={styles.aiSummaryContent}>
                  <Text style={styles.aiSummaryText}>
                    {aiSummary ||
                      "Swipe up to generate a summary of the current page."}
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
                  style={styles.aiSettingsButton}
                  onPress={configureOllamaUrl}
                >
                  <Ionicons name="settings-outline" size={20} color="#6200EE" />
                </TouchableOpacity>
              </View>
            </View>

            <TouchableOpacity
              style={styles.quickMenuCloseButton}
              onPress={hideQuickMenuHandler}
            >
              <Text style={styles.quickMenuCloseText}>Close</Text>
            </TouchableOpacity>
          </View>
        </Animated.View>
      )}

      {/* Table of Contents Modal */}
      <Modal
        visible={showToc}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setShowToc(false)}
      >
        <View style={styles.modalContainer}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Table of Contents</Text>
              <TouchableOpacity onPress={() => setShowToc(false)}>
                <Ionicons name="close" size={24} color="#333" />
              </TouchableOpacity>
            </View>
            <ScrollView style={styles.tocList}>
              {chapterTitles.map((title, index) => (
                <TouchableOpacity
                  key={index}
                  style={[
                    styles.tocItem,
                    currentChapter === index && styles.tocItemActive,
                  ]}
                  onPress={() => handleChapterChange(index)}
                >
                  <Text
                    style={[
                      styles.tocText,
                      currentChapter === index && styles.tocTextActive,
                    ]}
                  >
                    {title}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            <View style={styles.settingsSection}>
              <Text style={styles.settingsLabel}>Display Settings</Text>

              <View style={styles.fontSizeControls}>
                <Text style={styles.settingsSubLabel}>Font Size</Text>
                <TouchableOpacity
                  style={styles.fontSizeButton}
                  onPress={() =>
                    handleFontSizeChange(Math.max(70, fontSize - 10))
                  }
                >
                  <Text style={styles.fontSizeButtonText}>A-</Text>
                </TouchableOpacity>
                <Text style={styles.fontSizeValue}>{fontSize}%</Text>
                <TouchableOpacity
                  style={styles.fontSizeButton}
                  onPress={() =>
                    handleFontSizeChange(Math.min(200, fontSize + 10))
                  }
                >
                  <Text style={styles.fontSizeButtonText}>A+</Text>
                </TouchableOpacity>
              </View>

              <View style={styles.themeButtons}>
                <Text style={styles.settingsSubLabel}>Theme</Text>
                <View style={styles.themeButtonsRow}>
                  <TouchableOpacity
                    style={[
                      styles.themeButton,
                      styles.lightThemeButton,
                      theme === "light" && styles.activeThemeButton,
                    ]}
                    onPress={() => handleThemeChange("light")}
                  >
                    <Text style={styles.themeButtonText}>Light</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[
                      styles.themeButton,
                      styles.darkThemeButton,
                      theme === "dark" && styles.activeThemeButton,
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
                      theme === "sepia" && styles.activeThemeButton,
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
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#F8F8FC",
  },
  centeredContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  header: {
    paddingHorizontal: 16,
    paddingVertical: 16,
    backgroundColor: "#FFF",
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#E0E0E0",
    elevation: 2,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: "bold",
    color: "#333",
  },
  addButton: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#F0E6FF",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  addButtonText: {
    marginLeft: 4,
    color: "#6200EE",
    fontSize: 16,
    fontWeight: "500",
  },
  emptyLibrary: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 32,
  },
  emptyText: {
    fontSize: 20,
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
    backgroundColor: "#6200EE",
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 24,
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
    backgroundColor: "#FFF",
    borderRadius: 12,
    margin: 6,
    overflow: "hidden",
    elevation: 2,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    position: "relative",
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
    backgroundColor: "#F0F0F0",
    justifyContent: "center",
    alignItems: "center",
  },
  progressBar: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    height: 4,
    backgroundColor: "#E0E0E0",
  },
  progressFill: {
    height: "100%",
    backgroundColor: "#6200EE",
  },
  bookInfo: {
    padding: 12,
  },
  bookTitle: {
    fontSize: 16,
    fontWeight: "600",
    marginBottom: 4,
    color: "#333",
  },
  bookDate: {
    fontSize: 12,
    color: "#888",
  },
  removeButton: {
    position: "absolute",
    top: 8,
    right: 8,
    backgroundColor: "rgba(255, 255, 255, 0.8)",
    borderRadius: 12,
    width: 24,
    height: 24,
    justifyContent: "center",
    alignItems: "center",
  },
  readerContainer: {
    flex: 1,
    backgroundColor: "#FFF",
    position: "relative",
  },
  readerStatusBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingTop: 40,
    paddingHorizontal: 16,
    paddingBottom: 8,
    backgroundColor: "#FFF",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#E0E0E0",
  },
  backButton: {
    flexDirection: "row",
    alignItems: "center",
  },
  pagesLeftText: {
    fontSize: 14,
    color: "#666",
    marginLeft: 4,
  },
  closeButton: {
    padding: 4,
  },
  webViewContainer: {
    flex: 1,
    backgroundColor: "#FFF",
  },
  webView: {
    flex: 1,
  },
  menuButton: {
    position: "absolute",
    bottom: 20,
    right: 20,
    backgroundColor: "rgba(255, 255, 255, 0.8)",
    borderRadius: 20,
    width: 40,
    height: 40,
    justifyContent: "center",
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 3,
    elevation: 5,
  },
  modalContainer: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "flex-end",
  },
  modalContent: {
    backgroundColor: "#FFF",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: "80%",
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#E0E0E0",
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#333",
  },
  tocList: {
    padding: 12,
    maxHeight: 300,
  },
  tocItem: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#F0F0F0",
  },
  tocItemActive: {
    backgroundColor: "#F0F0F0",
    borderRadius: 8,
  },
  tocText: {
    fontSize: 16,
    color: "#333",
  },
  tocTextActive: {
    color: "#000",
    fontWeight: "600",
  },
  settingsSection: {
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: "#E0E0E0",
  },
  settingsLabel: {
    fontSize: 18,
    fontWeight: "600",
    marginBottom: 16,
    color: "#333",
  },
  settingsSubLabel: {
    fontSize: 16,
    fontWeight: "500",
    marginBottom: 8,
    color: "#333",
  },
  fontSizeControls: {
    marginBottom: 20,
  },
  fontSizeButton: {
    width: 40,
    height: 40,
    backgroundColor: "#F0F0F0",
    borderRadius: 20,
    justifyContent: "center",
    alignItems: "center",
    marginHorizontal: 10,
  },
  fontSizeButtonText: {
    fontSize: 16,
    fontWeight: "bold",
    color: "#333",
  },
  fontSizeValue: {
    fontSize: 16,
    color: "#333",
    marginHorizontal: 10,
  },
  themeButtons: {
    marginTop: 10,
  },
  themeButtonsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 8,
  },
  themeButton: {
    flex: 1,
    padding: 12,
    borderRadius: 8,
    marginHorizontal: 4,
    alignItems: "center",
  },
  lightThemeButton: {
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E0E0E0",
  },
  darkThemeButton: {
    backgroundColor: "#222222",
    borderWidth: 1,
    borderColor: "#222222",
  },
  sepiaThemeButton: {
    backgroundColor: "#f4ecd8",
    borderWidth: 1,
    borderColor: "#E0E0E0",
  },
  activeThemeButton: {
    borderColor: "#000",
    borderWidth: 2,
  },
  themeButtonText: {
    fontWeight: "500",
  },
  darkThemeText: {
    color: "#FFFFFF",
  },
  errorText: {
    fontSize: 16,
    color: "#FF3B30",
    textAlign: "center",
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
    width: "30%",
    height: "100%",
  },
  centerTapZone: {
    width: "40%",
    height: "100%",
  },
  rightTapZone: {
    width: "30%",
    height: "100%",
  },
  quickMenuContainer: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: "#FFF",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -3 },
    shadowOpacity: 0.2,
    shadowRadius: 5,
    elevation: 10,
    paddingBottom: 30,
  },
  quickMenuHandle: {
    alignItems: "center",
    paddingVertical: 10,
  },
  quickMenuHandleBar: {
    width: 40,
    height: 5,
    backgroundColor: "#DDD",
    borderRadius: 3,
  },
  quickMenuContent: {
    padding: 20,
  },
  quickMenuTitle: {
    fontSize: 20,
    fontWeight: "bold",
    marginBottom: 20,
    textAlign: "center",
  },
  quickMenuCloseButton: {
    backgroundColor: "#F0F0F0",
    padding: 12,
    borderRadius: 10,
    alignItems: "center",
    marginTop: 10,
  },
  quickMenuCloseText: {
    fontSize: 16,
    fontWeight: "500",
    color: "#333",
  },
  audioPlayerContainer: {
    backgroundColor: "#F8F8F8",
    borderRadius: 10,
    padding: 15,
    marginBottom: 20,
  },
  audioPlayerTitle: {
    fontSize: 16,
    fontWeight: "600",
    marginBottom: 10,
    color: "#333",
  },
  audioFileName: {
    fontSize: 14,
    color: "#666",
    marginBottom: 10,
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
    height: 6,
    backgroundColor: "#E0E0E0",
    borderRadius: 3,
    marginBottom: 15,
    overflow: "hidden",
  },
  audioProgressBar: {
    height: "100%",
    backgroundColor: "#6200EE",
  },
  audioControls: {
    flexDirection: "row",
    justifyContent: "center",
  },
  audioButton: {
    width: 50,
    height: 50,
    backgroundColor: "#FFF",
    borderRadius: 25,
    justifyContent: "center",
    alignItems: "center",
    marginHorizontal: 10,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  aiSummaryContainer: {
    backgroundColor: "#F8F8F8",
    borderRadius: 10,
    padding: 15,
    marginBottom: 20,
  },
  aiSummaryTitle: {
    fontSize: 16,
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
    backgroundColor: "#6200EE",
    padding: 10,
    borderRadius: 8,
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
    backgroundColor: "#F0F0F0",
    borderRadius: 20,
    justifyContent: "center",
    alignItems: "center",
  },
});
