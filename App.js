// App.js
import React, { useState, useEffect } from "react";
import { StatusBar } from "expo-status-bar";
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  SafeAreaView,
  FlatList,
  ActivityIndicator,
} from "react-native";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system";
import { Asset } from "expo-asset";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons } from "@expo/vector-icons";
import { NavigationContainer } from "@react-navigation/native";
import { createStackNavigator } from "@react-navigation/stack";
import { WebView } from "react-native-webview";

// Components
const Stack = createStackNavigator();

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

      // Add book to library
      const newBook = {
        id: newBookId,
        title: name.replace(".epub", ""),
        uri: newUri,
        coverUrl: null,
        lastOpenedAt: new Date().toISOString(),
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
        <ActivityIndicator size="large" color="#0000ff" />
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>My Library</Text>
        <TouchableOpacity style={styles.addButton} onPress={pickDocument}>
          <Ionicons name="add-circle" size={24} color="#007AFF" />
          <Text style={styles.addButtonText}>Add Book</Text>
        </TouchableOpacity>
      </View>

      {books.length === 0 ? (
        <View style={styles.emptyLibrary}>
          <Text style={styles.emptyText}>Your library is empty</Text>
          <Text style={styles.emptySubText}>
            Tap "Add Book" to import an ePub
          </Text>
        </View>
      ) : (
        <FlatList
          data={books}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.bookItem}
              onPress={() => openBook(item)}
            >
              <View style={styles.bookInfo}>
                <Text style={styles.bookTitle}>{item.title}</Text>
                <Text style={styles.bookDate}>
                  Last opened:{" "}
                  {new Date(item.lastOpenedAt).toLocaleDateString()}
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => removeBook(item.id)}
                style={styles.removeButton}
              >
                <Ionicons name="trash-outline" size={22} color="#FF3B30" />
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
  const [html, setHtml] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // In a real implementation, you would use a library like epubjs to parse the ePub
    // For this example, we'll display a simple viewer with the file path
    const generateSimpleViewer = () => {
      const viewerHtml = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
          <style>
            body {
              font-family: -apple-system, system-ui;
              line-height: 1.5;
              padding: 20px;
              margin: 0;
              color: #333;
            }
            h1 {
              font-size: 24px;
              margin-bottom: 20px;
            }
            p {
              margin-bottom: 16px;
            }
          </style>
        </head>
        <body>
          <h1>${book.title}</h1>
          <p>This is a basic ePub viewer. In a production app, you would integrate a library like epub.js to properly render the ePub content.</p>
          <p>Your ePub file is stored at: ${book.uri}</p>
          <p>In a full implementation, you would be able to:</p>
          <ul>
            <li>Navigate between chapters</li>
            <li>Adjust font size and theme</li>
            <li>Add bookmarks</li>
            <li>Search within the book</li>
            <li>See table of contents</li>
          </ul>
        </body>
        </html>
      `;
      setHtml(viewerHtml);
      setLoading(false);
    };

    generateSimpleViewer();

    // For a real implementation, you would parse the ePub file here
    // Example with epubjs (not included in this basic example):
    // const book = new ePub(book.uri);
    // book.ready.then(() => {
    //   // Render book content
    // });
  }, [book]);

  useEffect(() => {
    navigation.setOptions({
      title: book.title,
    });
  }, [navigation, book]);

  if (loading) {
    return (
      <View style={styles.centeredContainer}>
        <ActivityIndicator size="large" color="#0000ff" />
      </View>
    );
  }

  return (
    <WebView originWhitelist={["*"]} source={{ html }} style={styles.webView} />
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
            headerBackTitle: "Library",
          }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#F2F2F7",
  },
  centeredContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  header: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: "#FFF",
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#C8C7CC",
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: "bold",
  },
  addButton: {
    flexDirection: "row",
    alignItems: "center",
  },
  addButtonText: {
    marginLeft: 4,
    color: "#007AFF",
    fontSize: 16,
  },
  emptyLibrary: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 32,
  },
  emptyText: {
    fontSize: 18,
    fontWeight: "500",
    marginBottom: 8,
  },
  emptySubText: {
    fontSize: 16,
    color: "#666",
    textAlign: "center",
  },
  bookItem: {
    backgroundColor: "#FFF",
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#C8C7CC",
  },
  bookInfo: {
    flex: 1,
  },
  bookTitle: {
    fontSize: 17,
    fontWeight: "500",
    marginBottom: 2,
  },
  bookDate: {
    fontSize: 14,
    color: "#8E8E93",
  },
  removeButton: {
    padding: 8,
  },
  webView: {
    flex: 1,
  },
});
